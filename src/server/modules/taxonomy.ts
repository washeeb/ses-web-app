import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { brands, categories, media, products, productTags, slides, tags } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, invalid, notFound } from "../lib/errors";
import { slugify } from "../lib/slug";
import { SERVICE_AREAS } from "@/content/site";
import { audit } from "./audit";
import type { OwnerType } from "./media";

// ───────────────────────────── Categories ─────────────────────────────

export const categoryInput = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().max(80).optional().default(""),
  description: z.string().trim().max(1000).optional().default(""),
  parentId: z.string().uuid().nullable().optional(),
  skuCode: z.union([z.literal(""), z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "SKU code: three letters, e.g. NET.")]).optional().default(""),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});

/** All categories with parent name, product count and main image, parents first, children under them. */
export async function listCategoriesTree(db: DB) {
  const rows = await db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.name));
  const counts = await db.select({ id: products.categoryId, n: count() }).from(products).where(ne(products.status, "retired")).groupBy(products.categoryId);
  const n = new Map(counts.map((c) => [c.id, c.n]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const top = rows.filter((r) => !r.parentId || !byId.has(r.parentId));
  return top.flatMap((t) => [
    { ...t, depth: 0, parentName: null as string | null, productCount: n.get(t.id) ?? 0 },
    ...rows.filter((c) => c.parentId === t.id).map((c) => ({ ...c, depth: 1, parentName: t.name, productCount: n.get(c.id) ?? 0 })),
  ]);
}

async function uniqueSlug(db: DB, table: typeof categories | typeof brands | typeof tags, base: string, exceptId?: string) {
  const root = slugify(base) || "item";
  for (let i = 1; i < 50; i++) {
    const slug = i === 1 ? root : `${root}-${i}`;
    const [hit] = await db.select({ id: table.id }).from(table).where(eq(table.slug, slug));
    if (!hit || hit.id === exceptId) return slug;
  }
  throw conflict("Choose a more distinctive name.");
}

export async function saveCategory(db: DB, actor: Actor, id: string | null, input: z.input<typeof categoryInput>) {
  authorize(actor, "catalogue.write");
  const d = categoryInput.parse(input);
  return db.transaction(async (tx) => {
    const before = id ? (await tx.select().from(categories).where(eq(categories.id, id)))[0] : undefined;
    if (id && !before) throw notFound("Category not found.");
    if (d.parentId) {
      if (d.parentId === id) throw invalid("A category cannot be inside itself.");
      const [parent] = await tx.select().from(categories).where(eq(categories.id, d.parentId));
      if (!parent) throw invalid("Unknown parent category.");
      if (parent.parentId) throw invalid("Sub-categories go one level deep: choose a top-level parent.");
      if (id) {
        const [child] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id)).limit(1);
        if (child) throw invalid("This category has sub-categories, so it must stay top-level.");
      }
    }
    const slug = await uniqueSlug(tx, categories, d.slug || d.name, id ?? undefined);
    const values = { name: d.name, slug, description: d.description || null, parentId: d.parentId ?? null, skuCode: d.skuCode || null, active: d.active, sortOrder: d.sortOrder };
    const [row] = id
      ? await tx.update(categories).set(values).where(eq(categories.id, id)).returning()
      : await tx.insert(categories).values(values).returning();
    await audit(tx, { actor, action: id ? "category.updated" : "category.created", targetType: "category", targetId: row!.id, data: { before, after: values } });
    return row!;
  });
}

export async function deleteCategory(db: DB, actor: Actor, id: string) {
  authorize(actor, "catalogue.write");
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(categories).where(eq(categories.id, id));
    if (!c) throw notFound("Category not found.");
    const [{ n }] = (await tx.select({ n: count() }).from(products).where(eq(products.categoryId, id))) as [{ n: number }];
    if (n > 0) throw conflict(`${n} product${n === 1 ? " is" : "s are"} in this category. Move ${n === 1 ? "it" : "them"} first, or hide the category instead.`);
    const [child] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id)).limit(1);
    if (child) throw conflict("Remove or move its sub-categories first.");
    await tx.update(media).set({ deletedAt: new Date() }).where(and(eq(media.ownerType, "category"), eq(media.ownerId, id), isNull(media.deletedAt)));
    await tx.delete(categories).where(eq(categories.id, id));
    await audit(tx, { actor, action: "category.deleted", targetType: "category", targetId: id, data: { name: c.name } });
  });
}

/** Ids of a category and its sub-categories (for shop filtering). */
export async function categoryAndChildren(db: DB, id: string) {
  const kids = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, id));
  return [id, ...kids.map((k) => k.id)];
}

// ───────────────────────────── Brands ─────────────────────────────

export const brandInput = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).optional().default(""),
  website: z.union([z.literal(""), z.string().trim().url().max(200)]).optional().default(""),
  active: z.boolean().default(true),
});

export async function listBrands(db: DB) {
  const rows = await db.select().from(brands).orderBy(asc(sql`lower(${brands.name})`));
  const counts = await db.select({ id: products.brandId, n: count() }).from(products).where(ne(products.status, "retired")).groupBy(products.brandId);
  const n = new Map(counts.map((c) => [c.id, c.n]));
  return rows.map((b) => ({ ...b, productCount: n.get(b.id) ?? 0 }));
}

export async function saveBrand(db: DB, actor: Actor, id: string | null, input: z.input<typeof brandInput>) {
  authorize(actor, "catalogue.write");
  const d = brandInput.parse(input);
  return db.transaction(async (tx) => {
    if (id) {
      const [b] = await tx.select().from(brands).where(eq(brands.id, id));
      if (!b) throw notFound("Brand not found.");
    }
    const slug = await uniqueSlug(tx, brands, d.name, id ?? undefined);
    const values = { name: d.name, slug, description: d.description || null, website: d.website || null, active: d.active };
    const [row] = id ? await tx.update(brands).set(values).where(eq(brands.id, id)).returning() : await tx.insert(brands).values(values).returning();
    await audit(tx, { actor, action: id ? "brand.updated" : "brand.created", targetType: "brand", targetId: row!.id, data: values });
    return row!;
  });
}

export async function deleteBrand(db: DB, actor: Actor, id: string) {
  authorize(actor, "catalogue.write");
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(brands).where(eq(brands.id, id));
    if (!b) throw notFound("Brand not found.");
    const [{ n }] = (await tx.select({ n: count() }).from(products).where(eq(products.brandId, id))) as [{ n: number }];
    if (n > 0) throw conflict(`${n} product${n === 1 ? " uses" : "s use"} this brand. Change ${n === 1 ? "it" : "them"} first, or hide the brand.`);
    await tx.update(media).set({ deletedAt: new Date() }).where(and(eq(media.ownerType, "brand"), eq(media.ownerId, id), isNull(media.deletedAt)));
    await tx.delete(brands).where(eq(brands.id, id));
    await audit(tx, { actor, action: "brand.deleted", targetType: "brand", targetId: id, data: { name: b.name } });
  });
}

// ───────────────────────────── Tags ─────────────────────────────

export async function listTags(db: DB) {
  const rows = await db.select().from(tags).orderBy(asc(sql`lower(${tags.name})`));
  const counts = await db.select({ id: productTags.tagId, n: count() }).from(productTags).groupBy(productTags.tagId);
  const n = new Map(counts.map((c) => [c.id, c.n]));
  return rows.map((t) => ({ ...t, productCount: n.get(t.id) ?? 0 }));
}

/** "wireless, Back to school" → cleaned, de-duplicated names (max 15, each ≤ 40 characters). */
export function parseTagNames(text: string) {
  const seen = new Map<string, string>();
  for (const raw of text.split(/[,\n]/)) {
    const name = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    const slug = slugify(name);
    if (slug && !seen.has(slug)) seen.set(slug, name);
  }
  if (seen.size > 15) throw invalid("Up to 15 tags per product.");
  return [...seen.entries()].map(([slug, name]) => ({ slug, name }));
}

/** Replaces a product's tags, creating any new ones. Runs inside the caller's transaction. */
export async function setProductTags(tx: DB, productId: string, text: string) {
  const wanted = parseTagNames(text);
  const ids: string[] = [];
  for (const t of wanted) {
    const [hit] = await tx.select().from(tags).where(eq(tags.slug, t.slug));
    ids.push(hit ? hit.id : (await tx.insert(tags).values(t).returning())[0]!.id);
  }
  await tx.delete(productTags).where(eq(productTags.productId, productId));
  if (ids.length) await tx.insert(productTags).values(ids.map((tagId) => ({ productId, tagId })));
  return wanted.map((w) => w.name);
}

export async function tagsForProducts(db: DB, productIds: string[]) {
  const map = new Map<string, { id: string; slug: string; name: string }[]>();
  if (productIds.length === 0) return map;
  const rows = await db
    .select({ productId: productTags.productId, id: tags.id, slug: tags.slug, name: tags.name })
    .from(productTags)
    .innerJoin(tags, eq(tags.id, productTags.tagId))
    .where(inArray(productTags.productId, productIds))
    .orderBy(asc(sql`lower(${tags.name})`));
  for (const r of rows) map.set(r.productId, [...(map.get(r.productId) ?? []), { id: r.id, slug: r.slug, name: r.name }]);
  return map;
}

export async function renameTag(db: DB, actor: Actor, id: string, name: string) {
  authorize(actor, "catalogue.write");
  const clean = z.string().trim().min(1).max(40).parse(name);
  await db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx, tags, clean, id);
    const [row] = await tx.update(tags).set({ name: clean, slug }).where(eq(tags.id, id)).returning();
    if (!row) throw notFound("Tag not found.");
    await audit(tx, { actor, action: "tag.renamed", targetType: "tag", targetId: id, data: { name: clean } });
  });
}

export async function deleteTag(db: DB, actor: Actor, id: string) {
  authorize(actor, "catalogue.write");
  await db.transaction(async (tx) => {
    await tx.delete(productTags).where(eq(productTags.tagId, id));
    const [row] = await tx.delete(tags).where(eq(tags.id, id)).returning();
    if (!row) throw notFound("Tag not found.");
    await audit(tx, { actor, action: "tag.deleted", targetType: "tag", targetId: id, data: { name: row.name } });
  });
}

// ───────────────────────────── Specifications ─────────────────────────────

/** One "Name: value" per line → [{ name, value }] (max 40 rows). */
export function parseSpecs(text: string) {
  const rows: { name: string; value: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const at = t.indexOf(":");
    if (at <= 0) throw invalid(`Specification lines look like "Resolution: 4 MP" — check "${t.slice(0, 40)}".`);
    const name = t.slice(0, at).trim().slice(0, 60);
    const value = t.slice(at + 1).trim().slice(0, 200);
    if (name && value) rows.push({ name, value });
  }
  if (rows.length > 40) throw invalid("Up to 40 specification lines.");
  return rows;
}
export const specsToText = (specs: { name: string; value: string }[]) => specs.map((s) => `${s.name}: ${s.value}`).join("\n");

// ───────────────────────────── Image owners ─────────────────────────────

/** Confirms an image owner exists before files are stored for it. */
export async function assertImageOwner(db: DB, type: OwnerType, id: string) {
  const table = type === "product" ? products : type === "category" ? categories : type === "brand" ? brands : type === "slide" ? slides : null;
  if (!table) {
    if (type === "service" && SERVICE_AREAS.some((s) => s.slug === id)) return;
    throw notFound("Unknown page for this image.");
  }
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound("Unknown item for this image.");
  const [hit] = await db.select({ id: table.id }).from(table).where(eq(table.id, id));
  if (!hit) throw notFound("Unknown item for this image.");
}

