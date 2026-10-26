import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { approvalRequests, brands, categories, productMappings, products, productTags, productVariants, sequences, tags } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, invalid, notFound } from "../lib/errors";
import { slugify } from "../lib/slug";
import { audit } from "./audit";
import { listMedia, mainImages } from "./media";
import { categoryAndChildren, parseSpecs, setProductTags, tagsForProducts } from "./taxonomy";
import { publish } from "./events";
import { computeAvailability, levelsForVariants, type Availability } from "./inventory";
import { getSettings, operatorOrgId } from "./settings";
import { notifyApprovers } from "./notifications";

export const PRODUCT_TYPES = ["hardware", "software_licence", "subscription", "service_package"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];
export const PRODUCT_TYPE_LABEL: Record<ProductType, string> = {
  hardware: "Hardware",
  software_licence: "Software licence",
  subscription: "Subscription",
  service_package: "Service package",
};

/**
 * Assigns the next SKU, e.g. SE-NET-00012: the category's SKU code (or the first letters of its slug, GEN without a
 * category) and one counter for all categories, so a number is never reused. Runs inside the caller's transaction;
 * SKUs never change once assigned. Partner-supplied items keep the partner's SKU.
 */
export async function nextSku(db: DB, categoryId: string | null | undefined) {
  const [cat] = categoryId ? await db.select({ slug: categories.slug, skuCode: categories.skuCode }).from(categories).where(eq(categories.id, categoryId)) : [];
  const code = cat?.skuCode || (cat ? cat.slug.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase().padEnd(3, "X") : "GEN");
  for (let attempt = 0; attempt < 20; attempt++) {
    const [row] = await db
      .insert(sequences)
      .values({ key: "SKU", value: 1 })
      .onConflictDoUpdate({ target: sequences.key, set: { value: sql`${sequences.value} + 1` } })
      .returning();
    const sku = `SE-${code}-${String(row!.value).padStart(5, "0")}`;
    const [clash] = await db.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, sku));
    if (!clash) return sku;
  }
  throw conflict("Could not assign a free SKU. Try again.");
}

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

export type StoreSort = "name" | "price-asc" | "price-desc" | "newest";

type StoreFilter = { type?: string; q?: string; category?: string; brand?: string; tag?: string; sort?: StoreSort };

/** SQL conditions for the public store: active products with at least one active option, plus the filters. */
async function storeConditions(db: DB, filter: StoreFilter) {
  const conds = [eq(products.status, "active"), sql`exists (select 1 from ${productVariants} v where v.product_id = ${products.id} and v.active)`];
  if (filter.type && (PRODUCT_TYPES as readonly string[]).includes(filter.type)) conds.push(eq(products.type, filter.type as ProductType));
  if (filter.q) {
    const q = `%${filter.q.replace(/[%_\\]/g, "\\$&").slice(0, 80)}%`;
    // Matches names, summaries, SKUs and brand names.
    const skuHits = db.select({ id: productVariants.productId }).from(productVariants).where(ilike(productVariants.sku, q));
    conds.push(or(ilike(products.name, q), ilike(products.summary, q), ilike(brands.name, q), inArray(products.id, skuHits))!);
  }
  if (filter.category) {
    const [cat] = await db.select().from(categories).where(eq(categories.slug, filter.category));
    conds.push(cat ? inArray(products.categoryId, await categoryAndChildren(db, cat.id)) : sql`false`);
  }
  if (filter.brand) {
    const [b] = await db.select().from(brands).where(eq(brands.slug, filter.brand));
    conds.push(b ? eq(products.brandId, b.id) : sql`false`);
  }
  if (filter.tag) {
    const tagged = db.select({ id: productTags.productId }).from(productTags).innerJoin(tags, eq(tags.id, productTags.tagId)).where(eq(tags.slug, filter.tag));
    conds.push(inArray(products.id, tagged));
  }
  return and(...conds);
}

function storeOrder(sort: StoreSort | undefined) {
  const minPrice = sql`(select min(v.price_minor) from ${productVariants} v where v.product_id = ${products.id} and v.active)`;
  if (sort === "price-asc") return [sql`${minPrice} asc nulls last`, asc(products.name)];
  if (sort === "price-desc") return [sql`${minPrice} desc nulls last`, asc(products.name)];
  if (sort === "newest") return [desc(products.createdAt), asc(products.name)];
  return [asc(products.name)];
}

async function storeRows(db: DB, where: Awaited<ReturnType<typeof storeConditions>>, sort: StoreSort | undefined, page?: { limit: number; offset: number }) {
  const query = db
    .select({ product: products, categoryName: categories.name, categorySlug: categories.slug, brandName: brands.name, brandSlug: brands.slug })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(where)
    .orderBy(...storeOrder(sort));
  const rows = page ? await query.limit(page.limit).offset(page.offset) : await query;
  const ids = rows.map((r) => r.product.id);
  const [variants, images] = await Promise.all([attachVariants(db, ids), mainImages(db, "product", ids)]);
  return rows
    .map((r) => ({ ...r.product, categoryName: r.categoryName, categorySlug: r.categorySlug, brandName: r.brandName, brandSlug: r.brandSlug, image: images.get(r.product.id) ?? null, variants: variants.get(r.product.id) ?? [] }))
    .filter((p) => p.variants.length > 0);
}

/** Public store, all matching products. */
export async function listStoreProducts(db: DB, filter: StoreFilter = {}) {
  return storeRows(db, await storeConditions(db, filter), filter.sort);
}

export const STORE_PAGE_SIZE = 24;

/** One page of the public store, with the total for pagination. Only that page's prices, stock and pictures are loaded. */
export async function searchStoreProducts(db: DB, filter: StoreFilter & { page?: number } = {}, perPage = STORE_PAGE_SIZE) {
  const where = await storeConditions(db, filter);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(products).leftJoin(brands, eq(brands.id, products.brandId)).where(where)) as [{ n: number }];
  const pages = Math.max(1, Math.ceil(n / perPage));
  const page = Math.min(Math.max(1, Math.floor(filter.page ?? 1)), pages);
  const items = await storeRows(db, where, filter.sort, { limit: perPage, offset: (page - 1) * perPage });
  return { items, total: n, page, pages, perPage };
}

/** Products on sale per category (active, with an active option), for the store's category counts. */
export async function storeCategoryCounts(db: DB) {
  const rows = await db
    .select({ id: products.categoryId, n: sql<number>`count(*)::int` })
    .from(products)
    .where(and(eq(products.status, "active"), sql`exists (select 1 from ${productVariants} v where v.product_id = ${products.id} and v.active)`))
    .groupBy(products.categoryId);
  return new Map(rows.filter((r) => r.id).map((r) => [r.id!, r.n]));
}


export async function getStoreProduct(db: DB, slug: string) {
  const [row] = await db
    .select({ product: products, categoryName: categories.name, categorySlug: categories.slug, brandName: brands.name, brandSlug: brands.slug })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(and(eq(products.slug, slug), eq(products.status, "active")));
  if (!row) return null;
  const [variants, images, tagMap] = await Promise.all([attachVariants(db, [row.product.id]), listMedia(db, "product", [row.product.id]), tagsForProducts(db, [row.product.id])]);
  return { ...row.product, categoryName: row.categoryName, categorySlug: row.categorySlug, brandName: row.brandName, brandSlug: row.brandSlug, images, tags: tagMap.get(row.product.id) ?? [], variants: variants.get(row.product.id) ?? [] };
}

// ───────────────────────────── Management ─────────────────────────────

export async function listProductsAdmin(db: DB, actor: Actor) {
  authorize(actor, "catalogue.read");
  const rows = await db
    .select({ product: products, categoryName: categories.name, brandName: brands.name })
    .from(products)
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .orderBy(desc(products.updatedAt));
  const ids = rows.map((r) => r.product.id);
  const [variants, images] = await Promise.all([attachVariants(db, ids), mainImages(db, "product", ids)]);
  return rows.map((r) => ({ ...r.product, categoryName: r.categoryName, brandName: r.brandName, image: images.get(r.product.id) ?? null, variants: variants.get(r.product.id) ?? [] }));
}

export async function getProductAdmin(db: DB, actor: Actor, id: string) {
  authorize(actor, "catalogue.read");
  const [product] = await db.select().from(products).where(eq(products.id, id));
  if (!product) throw notFound("Product not found.");
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, id)).orderBy(asc(productVariants.sku));
  const variantIds = variants.map((v) => v.id);
  const [levels, images, tagMap] = await Promise.all([levelsForVariants(db, variantIds), listMedia(db, "product", [id]), tagsForProducts(db, [id])]);
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
    images,
    tags: tagMap.get(id) ?? [],
    variants: variants.map((v) => ({
      ...v,
      levels: levels.filter((l) => l.variantId === v.id),
      availability: computeAvailability(levels.filter((l) => l.variantId === v.id), v.tracksStock),
      mapping: mappings.find((m) => m.variantId === v.id) ?? null,
      pendingPriceChange: pendingPriceApprovals.find((a) => a.subjectId === v.id) ?? null,
    })),
  };
}

const RESERVED_SLUGS = new Set(["cart", "checkout"]);

export const productInput = z.object({
  name: z.string().trim().min(3).max(160),
  summary: z.string().trim().max(300).optional().default(""),
  description: z.string().trim().max(5000).optional().default(""),
  type: z.enum(PRODUCT_TYPES),
  categoryId: z.string().uuid().nullable().optional(),
  brandId: z.string().uuid().nullable().optional(),
  /** One "Name: value" per line. */
  specsText: z.string().max(10_000).optional().default(""),
  /** Comma-separated tag names; new tags are created. */
  tagsText: z.string().max(1000).optional().default(""),
  status: z.enum(["draft", "active", "retired"]).default("draft"),
});

async function productValues(tx: DB, p: z.output<typeof productInput>) {
  if (p.brandId) {
    const [b] = await tx.select({ id: brands.id }).from(brands).where(eq(brands.id, p.brandId));
    if (!b) throw notFound("Unknown brand.");
  }
  const { specsText, tagsText: _tags, ...rest } = p;
  return { ...rest, categoryId: p.categoryId ?? null, brandId: p.brandId ?? null, specs: parseSpecs(specsText) };
}

export const variantInput = z.object({
  /** Leave empty to have the next SKU assigned (see nextSku). */
  sku: z.union([z.literal(""), z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{2,40}$/, "SKU: 3–41 letters, digits or dashes.")]).optional(),
  name: z.string().trim().min(1).max(120),
  priceMinor: z.number().int().min(0).max(100_000_000_000),
  currency: z.string().length(3).default("GHS"),
  taxable: z.boolean().default(true),
  tracksStock: z.boolean().default(true),
  billingPeriod: z.enum(["month", "year"]).nullable().optional(),
  warrantyMonths: z.number().int().min(0).max(120).default(0),
});

export async function createProduct(db: DB, actor: Actor, input: z.input<typeof productInput>, firstVariant: z.input<typeof variantInput>) {
  authorize(actor, "catalogue.write");
  const p = productInput.parse(input);
  const v = variantInput.parse(firstVariant);
  return db.transaction(async (tx) => {
    let slug = slugify(p.name) || "product";
    const [clash] = await tx.select({ id: products.id }).from(products).where(eq(products.slug, slug));
    // "cart" is the store's own page (/store/cart), so a product may not take that address.
    if (clash || RESERVED_SLUGS.has(slug)) slug = `${slug}-${Date.now().toString(36)}`;
    const sku = v.sku || (await nextSku(tx, p.categoryId));
    const [skuClash] = await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, sku));
    if (skuClash) throw conflict(`SKU ${sku} is already in use.`);
    const [product] = await tx.insert(products).values({ ...(await productValues(tx, p)), slug }).returning();
    await setProductTags(tx, product!.id, p.tagsText);
    const [variant] = await tx.insert(productVariants).values({ ...v, sku, productId: product!.id, billingPeriod: v.billingPeriod ?? null }).returning();
    await audit(tx, { actor, action: "product.created", targetType: "product", targetId: product!.id, data: { ...p, sku, priceMinor: v.priceMinor } });
    return { product: product!, variant: variant! };
  }).finally(() => publish({ topic: "catalogue" }));
}

export async function updateProduct(db: DB, actor: Actor, id: string, input: z.input<typeof productInput>) {
  authorize(actor, "catalogue.write");
  const p = productInput.parse(input);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(products).where(eq(products.id, id));
    if (!before) throw notFound("Product not found.");
    await tx.update(products).set(await productValues(tx, p)).where(eq(products.id, id));
    await setProductTags(tx, id, p.tagsText);
    await audit(tx, { actor, action: "product.updated", targetType: "product", targetId: id, data: { before, after: p } });
  });
  publish({ topic: "catalogue" });
}

export async function addVariant(db: DB, actor: Actor, productId: string, input: z.input<typeof variantInput>) {
  authorize(actor, "catalogue.write");
  const v = variantInput.parse(input);
  const row = await db.transaction(async (tx) => {
    const [product] = await tx.select().from(products).where(eq(products.id, productId));
    if (!product) throw notFound("Product not found.");
    const sku = v.sku || (await nextSku(tx, product.categoryId));
    const [skuClash] = await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.sku, sku));
    if (skuClash) throw conflict(`SKU ${sku} is already in use.`);
    const [created] = await tx.insert(productVariants).values({ ...v, sku, productId, billingPeriod: v.billingPeriod ?? null }).returning();
    await audit(tx, { actor, action: "variant.created", targetType: "variant", targetId: created!.id, data: { ...v, sku } });
    return created!;
  });
  publish({ topic: "catalogue" });
  return row;
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
      await notifyApprovers(tx, "price.change", variantId, req!.summary, actor.userId);
      return { applied: false, approvalId: req!.id };
    }
    await applyPrice(tx, variantId, newPriceMinor, { actor, source: `manual: ${reason}` });
    return { applied: true, approvalId: null };
  });
  publish({ topic: result.applied ? "catalogue" : "approvals" });
  return result;
}
