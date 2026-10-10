import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { approvalRequests, categories, productMappings, products, productVariants } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, invalid, notFound } from "../lib/errors";
import { audit } from "./audit";
import { publish } from "./events";
import { computeAvailability, levelsForVariants, type Availability } from "./inventory";
import { getSettings, operatorOrgId } from "./settings";

export const PRODUCT_TYPES = ["hardware", "software_licence", "subscription", "service_package"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
export const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  hardware: "Hardware",
  software_licence: "Software licence",
  subscription: "Subscription",
  service_package: "Service package",
};

export async function listCategories(db: DB) {
  return db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
}

export interface StoreVariant {
  id: string;
  sku: string;
  name: string;
  priceMinor: number;
  currency: string;
  billingPeriod: string | null;
  tracksStock: boolean;
  availability: Availability;
}

async function attachVariants(db: DB, productIds: string[], now = new Date()) {
  if (productIds.length === 0) return new Map<string, StoreVariant[]>();
  const variants = await db
    .select()
    .from(productVariants)
    .where(and(inArray(productVariants.productId, productIds), eq(productVariants.active, true)))
    .orderBy(asc(productVariants.priceMinor));
  const levels = await levelsForVariants(db, variants.map((v) => v.id));
  const map = new Map<string, StoreVariant[]>();
  for (const v of variants) {
    const vLevels = levels.filter((l) => l.variantId === v.id);
    const sv: StoreVariant = {
      id: v.id,
      sku: v.sku,
      name: v.name,
      priceMinor: v.priceMinor,
      currency: v.currency,
      billingPeriod: v.billingPeriod,
      tracksStock: v.tracksStock,
      availability: computeAvailability(vLevels, v.tracksStock, now),
    };
    map.set(v.productId, [...(map.get(v.productId) ?? []), sv]);
  }
  return map;
}

/** Public catalogue: active products only. */
export async function listStoreProducts(db: DB, filter: { type?: string; q?: string; category?: string } = {}) {
  const conds = [eq(products.status, "active")];
  if (filter.type && (PRODUCT_TYPES as readonly string[]).includes(filter.type)) conds.push(eq(products.type, filter.type as ProductType));
  if (filter.q) {
    const q = `%${filter.q.replace(/[%_\\]/g, "\\$&").slice(0, 80)}%`;
    conds.push(or(ilike(products.name, q), ilike(products.summary, q))!);
  }
  if (filter.category) {
    const [cat] = await db.select().from(categories).where(eq(categories.slug, filter.category));
    if (cat) conds.push(eq(products.categoryId, cat.id));
  }
  const rows = await db
    .select({ product: products, categoryName: categories.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(...conds))
    .orderBy(asc(products.name));
  const variants = await attachVariants(db, rows.map((r) => r.product.id));
  return rows
    .map((r) => ({ ...r.product, categoryName: r.categoryName, variants: variants.get(r.product.id) ?? [] }))
    .filter((p) => p.variants.length > 0);
}

export async function getStoreProduct(db: DB, slug: string) {
  const [row] = await db
    .select({ product: products, categoryName: categories.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(eq(products.slug, slug), eq(products.status, "active")));
  if (!row) return null;
  const variants = await attachVariants(db, [row.product.id]);
  return { ...row.product, categoryName: row.categoryName, variants: variants.get(row.product.id) ?? [] };
}

// ───────────────────────────── Management ─────────────────────────────

export async function listProductsAdmin(db: DB, actor: Actor) {
  authorize(actor, "catalogue.read");
  const rows = await db
    .select({ product: products, categoryName: categories.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .orderBy(desc(products.updatedAt));
  const variants = await attachVariants(db, rows.map((r) => r.product.id));
  return rows.map((r) => ({ ...r.product, categoryName: r.categoryName, variants: variants.get(r.product.id) ?? [] }));
}

export async function getProductAdmin(db: DB, actor: Actor, id: string) {
  authorize(actor, "catalogue.read");
  const [product] = await db.select().from(products).where(eq(products.id, id));
  if (!product) throw notFound("Product not found.");
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, id)).orderBy(asc(productVariants.sku));
  const variantIds = variants.map((v) => v.id);
  const levels = await levelsForVariants(db, variantIds);
  const mappings = variantIds.length
    ? await db.select().from(productMappings).where(inArray(productMappings.variantId, variantIds))
    : [];
  const pendingPriceApprovals = variantIds.length
    ? await db
        .select()
        .from(approvalRequests)
        .where(and(eq(approvalRequests.type, "price.change"), eq(approvalRequests.status, "pending"), inArray(approvalRequests.subjectId, variantIds)))
    : [];
  return {
    product,
    variants: variants.map((v) => ({
      ...v,
      levels: levels.filter((l) => l.variantId === v.id),
      availability: computeAvailability(levels.filter((l) => l.variantId === v.id), v.tracksStock),
      mapping: mappings.find((m) => m.variantId === v.id) ?? null,
      pendingPriceChange: pendingPriceApprovals.find((a) => a.subjectId === v.id) ?? null,
    })),
  };
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

export const productInput = z.object({
  name: z.string().trim().min(3).max(160),
  summary: z.string().trim().max(300).optional().default(""),
  description: z.string().trim().max(5000).optional().default(""),
  type: z.enum(PRODUCT_TYPES),
  categoryId: z.string().uuid().nullable().optional(),
  status: z.enum(["draft", "active", "retired"]).default("draft"),
});

export const variantInput = z.object({
  sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,40}$/, "SKU: 3–41 letters, digits or dashes."),
  name: z.string().trim().min(1).max(120),
  priceMinor: z.number().int().min(0).max(100_000_000_000),
  currency: z.string().length(3).default("GHS"),
  taxable: z.boolean().default(true),
  tracksStock: z.boolean().default(true),
  billingPeriod: z.enum(["month", "year"]).nullable().optional(),
});

export async function createProduct(db: DB, actor: Actor, input: z.input<typeof productInput>, firstVariant: z.input<typeof variantInput>) {
  authorize(actor, "catalogue.write");
  const p = productInput.parse(input);
  const v = variantInput.parse(firstVariant);
  return db.transaction(async (tx) => {
    let slug = slugify(p.name) || "product";
    const [clash] = await tx.select({ id: products.id }).from(products).where(eq(products.slug, slug));
    if (clash) slug = `${slug}-${Date.now().toString(36)}`;
    const [skuClash] = await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, v.sku));
    if (skuClash) throw conflict(`SKU ${v.sku} is already in use.`);
    const [product] = await tx.insert(products).values({ ...p, slug, categoryId: p.categoryId ?? null }).returning();
    const [variant] = await tx.insert(productVariants).values({ ...v, productId: product!.id, billingPeriod: v.billingPeriod ?? null }).returning();
    await audit(tx, { actor, action: "product.created", targetType: "product", targetId: product!.id, data: { ...p, sku: v.sku, priceMinor: v.priceMinor } });
    return { product: product!, variant: variant! };
  }).finally(() => publish({ topic: "catalogue" }));
}

export async function updateProduct(db: DB, actor: Actor, id: string, input: z.input<typeof productInput>) {
  authorize(actor, "catalogue.write");
  const p = productInput.parse(input);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(eq(products.id, id));
    if (!before) throw notFound("Product not found.");
    await tx.update(products).set({ ...p, categoryId: p.categoryId ?? null }).where(eq(products.id, id));
    await audit(tx, { actor, action: "product.updated", targetType: "product", targetId: id, data: { before, after: p } });
  });
  publish({ topic: "catalogue" });
}

export async function addVariant(db: DB, actor: Actor, productId: string, input: z.input<typeof variantInput>) {
  authorize(actor, "catalogue.write");
  const v = variantInput.parse(input);
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product) throw notFound("Product not found.");
  const [skuClash] = await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, v.sku));
  if (skuClash) throw conflict(`SKU ${v.sku} is already in use.`);
  const [row] = await db.insert(productVariants).values({ ...v, productId, billingPeriod: v.billingPeriod ?? null }).returning();
  await audit(db, { actor, action: "variant.created", targetType: "variant", targetId: row!.id, data: v });
  publish({ topic: "catalogue" });
  return row!;
}

/** Applies a price inside the caller's transaction (used by approvals and partner feeds). */
export async function applyPrice(tx: DB, variantId: string, newPriceMinor: number, meta: { actor?: Actor | null; source: string; approvalId?: string }) {
  const [before] = await tx.select().from(productVariants).where(eq(productVariants.id, variantId));
  if (!before) throw notFound("Variant not found.");
  await tx.update(productVariants).set({ priceMinor: newPriceMinor }).where(eq(productVariants.id, variantId));
  await audit(tx, {
    actor: meta.actor ?? null,
    action: "price.changed",
    targetType: "variant",
    targetId: variantId,
    data: { sku: before.sku, from: before.priceMinor, to: newPriceMinor, source: meta.source, approvalId: meta.approvalId },
  });
}

export const changeBp = (from: number, to: number) => (from === 0 ? (to === 0 ? 0 : 10_000) : Math.round((Math.abs(to - from) * 10_000) / from));

/**
 * Price changes at or above the sensitive threshold are held for approval by someone else.
 * Returns whether the change was applied immediately.
 */
export async function requestPriceChange(db: DB, actor: Actor, variantId: string, newPriceMinor: number, reason: string) {
  authorize(actor, "catalogue.write");
  if (!Number.isInteger(newPriceMinor) || newPriceMinor < 0) throw invalid("Enter a valid price.");
  if (reason.trim().length < 3) throw invalid("Give a reason for the price change.");
  const s = await getSettings(db);
  const result = await db.transaction(async (tx) => {
    const [v] = await tx.select().from(productVariants).where(eq(productVariants.id, variantId)).for("update");
    if (!v) throw notFound("Variant not found.");
    if (v.priceMinor === newPriceMinor) throw invalid("That is already the price.");
    const [pending] = await tx
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(and(eq(approvalRequests.type, "price.change"), eq(approvalRequests.subjectId, variantId), eq(approvalRequests.status, "pending")));
    if (pending) throw conflict("A price change for this item is already awaiting approval.");
    const delta = changeBp(v.priceMinor, newPriceMinor);
    if (delta >= s.sensitivePriceChangeBp) {
      const [req] = await tx
        .insert(approvalRequests)
        .values({
          organizationId: await operatorOrgId(tx),
          type: "price.change",
          subjectType: "variant",
          subjectId: variantId,
          summary: `Price change for ${v.sku}: ${v.priceMinor} → ${newPriceMinor} (${(delta / 100).toFixed(1)}%)`,
          payload: { variantId, sku: v.sku, fromMinor: v.priceMinor, toMinor: newPriceMinor, currency: v.currency, reason, source: "manual" },
          requestedBy: actor.userId,
        })
        .returning();
      await audit(tx, { actor, action: "price.change_requested", targetType: "variant", targetId: variantId, data: { approvalId: req!.id, from: v.priceMinor, to: newPriceMinor, reason } });
      return { applied: false, approvalId: req!.id };
    }
    await applyPrice(tx, variantId, newPriceMinor, { actor, source: `manual: ${reason}` });
    return { applied: true, approvalId: null };
  });
  publish({ topic: result.applied ? "catalogue" : "approvals" });
  return result;
}
