import { readFile } from "node:fs/promises";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { categories, slides } from "../db/schema";
import type { Actor } from "../authz/policy";
import { addImage, listMedia, MEDIA_WIDTHS, type OwnerType } from "./media";
import { saveSlide } from "./slides";

/**
 * Installs the Synclytics starter illustrations (built by `npm run images:build`) into the picture library.
 * Only fills gaps: a service or category that already has a picture is left alone, and slides are only created
 * when there are none. Safe to run more than once.
 */
type Manifest = {
  services: { slug: string; image: string; alt: string }[];
  categories: { slug: string; image: string; alt: string }[];
  slides: { headline: string; body: string; ctaLabel: string; ctaHref: string; image: string; alt: string }[];
};

export async function installStarterImages(db: DB, actor: Actor, dir: string) {
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  const files = async (image: string) => {
    if (!/^[a-zA-Z0-9-]+$/.test(image)) throw new Error(`Bad image name in manifest: ${image}`);
    return Promise.all(MEDIA_WIDTHS.map(async (width) => ({ width, bytes: await readFile(path.join(dir, image, `${width}.webp`)) })));
  };
  const result = { added: [] as string[], skipped: [] as string[] };
  const fill = async (type: OwnerType, ownerId: string, label: string, image: string, alt: string) => {
    if ((await listMedia(db, type, [ownerId])).length > 0) return result.skipped.push(`${label} (already has a picture)`);
    await addImage(db, actor, type, ownerId, { files: await files(image), alt });
    result.added.push(label);
  };

  for (const s of manifest.services) await fill("service", s.slug, `service ${s.slug}`, s.image, s.alt);
  for (const c of manifest.categories) {
    const [cat] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, c.slug));
    if (!cat) result.skipped.push(`category ${c.slug} (not found)`);
    else await fill("category", cat.id, `category ${c.slug}`, c.image, c.alt);
  }
  const [{ n }] = (await db.select({ n: count() }).from(slides)) as [{ n: number }];
  if (n > 0) result.skipped.push(`slides (${n} already set up)`);
  else {
    for (const [i, s] of manifest.slides.entries()) {
      const row = await saveSlide(db, actor, null, { headline: s.headline, body: s.body, ctaLabel: s.ctaLabel, ctaHref: s.ctaHref, active: true, sortOrder: i * 10 });
      await addImage(db, actor, "slide", row.id, { files: await files(s.image), alt: s.alt });
      result.added.push(`slide "${s.headline}"`);
    }
  }
  return result;
}
