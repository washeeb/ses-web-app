import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { kbArticles, users } from "../db/schema";
import { authorize, can, type Actor } from "../authz/policy";
import { conflict, notFound } from "../lib/errors";
import { audit } from "./audit";

/**
 * Knowledge base: public help on the website, customer-only guides in the portal, and internal notes for staff.
 * Search uses PostgreSQL full-text search (English stemming) over title, summary and body.
 */
export const KB_CATEGORIES = ["general", "accounts", "billing", "network", "hardware", "software", "security", "how-to"] as const;
const AUDIENCES = ["public", "customers", "internal"] as const;

/** Which audiences a viewer may read. */
export function audiencesFor(actor: Actor | null): string[] {
  if (!actor) return ["public"];
  if (actor.organizationType === "operator") return can(actor, "kb.write") || can(actor, "support.read") ? ["public", "customers", "internal"] : ["public", "customers"];
  if (actor.organizationType === "customer") return ["public", "customers"];
  return ["public"];
}

const doc = sql`to_tsvector('english', ${kbArticles.title} || ' ' || coalesce(${kbArticles.summary}, '') || ' ' || ${kbArticles.body})`;

export async function searchArticles(db: DB, actor: Actor | null, q: string, limit = 20) {
  const audiences = audiencesFor(actor);
  const query = q.trim().slice(0, 200);
  const base = and(eq(kbArticles.status, "published"), inArray(kbArticles.audience, audiences));
  if (!query) {
    return db.select().from(kbArticles).where(base).orderBy(desc(kbArticles.updatedAt)).limit(limit);
  }
  // websearch_to_tsquery never throws on user input (quotes, operators, stray symbols are all accepted).
  const tsq = sql`websearch_to_tsquery('english', ${query})`;
  return db
    .select()
    .from(kbArticles)
    .where(and(base, sql`${doc} @@ ${tsq}`))
    .orderBy(sql`ts_rank(${doc}, ${tsq}) desc`)
    .limit(limit);
}

export async function getArticleBySlug(db: DB, actor: Actor | null, slug: string) {
  const [a] = await db.select().from(kbArticles).where(eq(kbArticles.slug, slug));
  const staffEditor = actor ? can(actor, "kb.write") : false;
  if (!a || (!staffEditor && (a.status !== "published" || !audiencesFor(actor).includes(a.audience)))) throw notFound("Article not found.");
  return a;
}

export async function listAllArticles(db: DB, actor: Actor) {
  authorize(actor, "kb.write");
  return db
    .select({ a: kbArticles, editor: users.name })
    .from(kbArticles)
    .leftJoin(users, eq(users.id, kbArticles.updatedBy))
    .orderBy(desc(kbArticles.updatedAt))
    .limit(500);
}

export const articleInput = z.object({
  title: z.string().trim().min(5).max(160),
  summary: z.string().trim().max(300).optional().default(""),
  body: z.string().trim().min(20, "Write the article (at least 20 characters).").max(30_000),
  category: z.enum(KB_CATEGORIES),
  audience: z.enum(AUDIENCES),
  status: z.enum(["draft", "published"]),
});

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "article";

export async function saveArticle(db: DB, actor: Actor, id: string | null, input: z.input<typeof articleInput>) {
  authorize(actor, "kb.write");
  const data = articleInput.parse(input);
  const now = new Date();
  if (id) {
    const [before] = await db.select().from(kbArticles).where(eq(kbArticles.id, id));
    if (!before) throw notFound("Article not found.");
    await db
      .update(kbArticles)
      .set({ ...data, summary: data.summary || null, updatedBy: actor.userId, publishedAt: data.status === "published" ? (before.publishedAt ?? now) : before.publishedAt })
      .where(eq(kbArticles.id, id));
    await audit(db, { actor, action: "kb.updated", targetType: "kb_article", targetId: id, data: { status: data.status, audience: data.audience } });
    return { id, slug: before.slug };
  }
  let slug = slugify(data.title);
  const [clash] = await db.select({ id: kbArticles.id }).from(kbArticles).where(eq(kbArticles.slug, slug));
  if (clash) slug = `${slug}-${now.getTime().toString(36)}`;
  const [row] = await db
    .insert(kbArticles)
    .values({ ...data, summary: data.summary || null, slug, updatedBy: actor.userId, publishedAt: data.status === "published" ? now : null })
    .returning();
  await audit(db, { actor, action: "kb.created", targetType: "kb_article", targetId: row!.id, data: { slug, status: data.status, audience: data.audience } });
  return { id: row!.id, slug };
}

export async function getArticleForEdit(db: DB, actor: Actor, id: string) {
  authorize(actor, "kb.write");
  const [a] = await db.select().from(kbArticles).where(eq(kbArticles.id, id));
  if (!a) throw notFound("Article not found.");
  return a;
}

export async function deleteArticle(db: DB, actor: Actor, id: string) {
  authorize(actor, "kb.write");
  const [a] = await db.select().from(kbArticles).where(eq(kbArticles.id, id));
  if (!a) throw notFound("Article not found.");
  if (a.status === "published") throw conflict("Unpublish the article (set it to draft) before deleting it.");
  await db.delete(kbArticles).where(eq(kbArticles.id, id));
  await audit(db, { actor, action: "kb.deleted", targetType: "kb_article", targetId: id, data: { slug: a.slug, title: a.title } });
}
