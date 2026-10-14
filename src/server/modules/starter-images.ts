import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import { categories, slides } from "../db/schema";
import type { Actor } from "../authz/policy";
import { addImage, deleteImage, listMedia, MEDIA_WIDTHS, type OwnerType } from "./media";
import { listSlides, saveSlide } from "./slides";

/**
 * Installs the starter pictures (built by `npm run images:build`) into the picture library. Safe to run again:
 * - an item with no picture gets the starter picture;
 * - an item whose pictures are all earlier starter pictures (recognised by file fingerprint) gets the new version;
 * - anything else (a picture staff uploaded) is left alone;
 * - slides are created only when there are none; existing starter slides get new pictures, matched by their link.
 */
type Manifest = {
  services: { slug: string; image: string; alt: string }[];
  categories: { slug: string; image: string; alt: string }[];
  slides: { headline: string; body: string; ctaLabel: string; ctaHref: string; image: string; alt: string }[];
  /** SHA-256 of the largest copy of every earlier starter picture. */
  replaceable?: string[];
};

export async function installStarterImages(db: DB, actor: Actor, dir: string) {
  const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  const replaceable = new Set(manifest.replaceable ?? []);
  const files = async (image: string) => {
    if (!/^[a-zA-Z0-9-]+$/.test(image)) throw new Error(`Bad image name in manifest: ${image}`);
    return Promise.all(MEDIA_WIDTHS.map(async (width) => ({ width, bytes: await readFile(path.join(dir, image, `${width}.webp`)) })));
  };
  const result = { added: [] as string[], updated: [] as string[], skipped: [] as string[] };
  const fill = async (type: OwnerType, ownerId: string, label: string, image: string, alt: string) => {
    const existing = await listMedia(db, type, [ownerId]);
    const copies = await files(image);
    const sha = createHash("sha256").update(copies[copies.length - 1]!.bytes).digest("hex");
    if (existing.length === 0) {
      await addImage(db, actor, type, ownerId, { files: copies, alt });
      return result.added.push(label);
    }
    if (existing.some((m) => m.sha256 === sha)) return result.skipped.push(`${label} (already up to date)`);
    if (!existing.every((m) => replaceable.has(m.sha256))) return result.skipped.push(`${label} (has its own picture)`);
    for (const m of existing) await deleteImage(db, actor, m.id);
    await addImage(db, actor, type, ownerId, { files: copies, alt });
    result.updated.push(label);
  };

  for (const s of manifest.services) await fill("service", s.slug, `service ${s.slug}`, s.image, s.alt);
  for (const c of manifest.categories) {
    const [cat] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, c.slug));
    if (!cat) result.skipped.push(`category ${c.slug} (not found)`);
    else await fill("category", cat.id, `category ${c.slug}`, c.image, c.alt);
  }
  const [{ n }] = (await db.select({ n: count() }).from(slides)) as [{ n: number }];
  if (n === 0) {
    for (const [i, s] of manifest.slides.entries()) {
      const row = await saveSlide(db, actor, null, { headline: s.headline, body: s.body, ctaLabel: s.ctaLabel, ctaHref: s.ctaHref, active: true, sortOrder: i * 10 });
      await addImage(db, actor, "slide", row.id, { files: await files(s.image), alt: s.alt });
      result.added.push(`slide "${s.headline}"`);
    }
  } else {
    for (const row of await listSlides(db)) {
      const s = manifest.slides.find((x) => x.ctaHref === row.ctaHref);
      if (s) await fill("slide", row.id, `slide "${row.headline}"`, s.image, s.alt);
    }
  }
  return result;
}
