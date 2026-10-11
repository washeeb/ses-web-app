import type { MetadataRoute } from "next";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { kbArticles, products } from "@/server/db/schema";

/** Public pages only: published products and public help articles. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = process.env.APP_URL ?? "https://synclyticsenterprisesystems.com";
  const db = getDb();
  const [items, articles] = await Promise.all([
    db.select({ slug: products.slug, updatedAt: products.updatedAt }).from(products).where(and(eq(products.status, "active"), eq(products.isDemo, false))),
    db.select({ slug: kbArticles.slug, updatedAt: kbArticles.updatedAt }).from(kbArticles).where(and(eq(kbArticles.status, "published"), eq(kbArticles.audience, "public"))),
  ]);
  const pages = ["", "/services", "/store", "/partners", "/case-studies", "/help", "/contact", "/privacy"].map((p) => ({ url: `${base}${p}` }));
  return [
    ...pages,
    ...items.map((p) => ({ url: `${base}/store/${p.slug}`, lastModified: p.updatedAt })),
    ...articles.map((a) => ({ url: `${base}/help/${a.slug}`, lastModified: a.updatedAt })),
  ];
}
