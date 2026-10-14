import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import { media } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { invalid, notFound } from "../lib/errors";
import { audit } from "./audit";
import { uploadRoot } from "./documents";

/**
 * Images for products, categories, brands and service areas.
 *
 * - The browser resizes each picture to standard widths and re-encodes it (WebP where supported). Re-encoding drops
 *   camera metadata such as GPS location, and keeps pages fast on mobile data.
 * - The server never trusts the browser: each file's type is checked by its content (magic bytes), its pixel size
 *   is read from the file header, and sizes and counts are capped.
 * - Without JavaScript a single original image is accepted if it is already within the limits.
 * - Files live outside the deployed app folder (each deploy replaces it), under the row id, never a user-chosen name.
 */
export const MEDIA_WIDTHS = [320, 800, 1600] as const;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 4000;
export const MAX_IMAGES_PER_OWNER = 12;
export type OwnerType = "product" | "category" | "brand" | "service" | "slide";
export const OWNER_TYPES: OwnerType[] = ["product", "category", "brand", "service", "slide"];
type Ext = "webp" | "jpg" | "png";
export const CONTENT_TYPES: Record<Ext, string> = { webp: "image/webp", jpg: "image/jpeg", png: "image/png" };

/** Pictures sit beside the secure documents, under UPLOAD_DIR (../ses-data/uploads in production). */
export function mediaRoot() {
  return path.join(/*turbopackIgnore: true*/ uploadRoot(), "media");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function fileFor(id: string, width: number, ext: Ext) {
  if (!UUID.test(id)) throw new Error("Invalid media id");
  return path.join(/*turbopackIgnore: true*/ mediaRoot(), id.slice(0, 2), id, `${width}.${ext}`);
}

/** Identifies an image by its content and reads its pixel size from the header. Returns null for anything else. */
export function inspectImage(b: Buffer): { ext: Ext; width: number; height: number } | null {
  // PNG: signature, then IHDR width/height (big-endian).
  if (b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && b.subarray(12, 16).toString("latin1") === "IHDR") {
    return { ext: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  // WebP: RIFF....WEBP then a VP8 / VP8L / VP8X chunk.
  if (b.length > 30 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") {
    const chunk = b.subarray(12, 16).toString("latin1");
    if (chunk === "VP8X") return { ext: "webp", width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === "VP8L" && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21);
      return { ext: "webp", width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { ext: "webp", width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    return null;
  }
  // JPEG: walk the markers to the first start-of-frame.
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = b.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { ext: "jpg", width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

export type UploadSet = {
  /** Copies keyed by width (from the browser), or one original under its own width (no JavaScript). */
  files: { width: number; bytes: Buffer }[];
  alt: string;
};

/** Validates one picture's copies: same type, matching declared widths, decreasing sizes, within limits. */
export function checkUploadSet(set: UploadSet) {
  if (set.files.length === 0) throw invalid("Choose an image to upload.");
  if (set.files.length > MEDIA_WIDTHS.length) throw invalid("Too many files for one image.");
  const seen = set.files
    .map((f) => {
      if (f.bytes.length === 0) throw invalid("The image file is empty.");
      if (f.bytes.length > MAX_IMAGE_BYTES) throw invalid(`Each image must be ${MAX_IMAGE_BYTES / 1024 / 1024} MB or smaller. Try a smaller picture.`);
      const info = inspectImage(f.bytes);
      if (!info) throw invalid("Use a JPEG, PNG or WebP image.");
      if (info.width < 1 || info.height < 1 || info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE) throw invalid(`Images must be at most ${MAX_IMAGE_SIDE} pixels on each side.`);
      if (info.width !== f.width) throw invalid("The image size does not match its label.");
      return { ...f, ...info };
    })
    .sort((a, b) => a.width - b.width);
  if (new Set(seen.map((s) => s.ext)).size > 1) throw invalid("All copies of an image must be the same type.");
  if (new Set(seen.map((s) => s.width)).size !== seen.length) throw invalid("Duplicate image sizes.");
  const alt = set.alt.trim().replace(/\s+/g, " ").slice(0, 200);
  return { copies: seen, alt, largest: seen[seen.length - 1]! };
}

export async function listMedia(db: DB, ownerType: OwnerType, ownerIds: string[]) {
  if (ownerIds.length === 0) return [];
  return db
    .select()
    .from(media)
    .where(and(eq(media.ownerType, ownerType), inArray(media.ownerId, ownerIds), isNull(media.deletedAt)))
    .orderBy(asc(media.sortOrder), asc(media.createdAt));
}

/** Main image (lowest sort order) per owner. */
export async function mainImages(db: DB, ownerType: OwnerType, ownerIds: string[]) {
  const map = new Map<string, MediaRow>();
  for (const m of await listMedia(db, ownerType, ownerIds)) if (!map.has(m.ownerId)) map.set(m.ownerId, m);
  return map;
}
export type MediaRow = typeof media.$inferSelect;

export async function addImage(db: DB, actor: Actor, ownerType: OwnerType, ownerId: string, set: UploadSet) {
  authorize(actor, "catalogue.write");
  if (!OWNER_TYPES.includes(ownerType)) throw invalid("Unknown image owner.");
  const { copies, alt, largest } = checkUploadSet(set);
  const existing = await listMedia(db, ownerType, [ownerId]);
  if (existing.length >= MAX_IMAGES_PER_OWNER) throw invalid(`Up to ${MAX_IMAGES_PER_OWNER} images each. Remove one first.`);
  const id = randomUUID();
  const dir = path.dirname(fileFor(id, largest.width, largest.ext));
  await mkdir(dir, { recursive: true });
  try {
    for (const c of copies) {
      const target = fileFor(id, c.width, c.ext);
      await writeFile(`${target}.tmp`, c.bytes, { mode: 0o644 });
      await rename(`${target}.tmp`, target);
    }
    const [row] = await db
      .insert(media)
      .values({
        id,
        ownerType,
        ownerId,
        widths: copies.map((c) => c.width),
        ext: largest.ext,
        width: largest.width,
        height: largest.height,
        bytes: copies.reduce((n, c) => n + c.bytes.length, 0),
        sha256: createHash("sha256").update(largest.bytes).digest("hex"),
        alt,
        sortOrder: existing.length ? Math.max(...existing.map((e) => e.sortOrder)) + 1 : 0,
        uploadedBy: actor.userId,
      })
      .returning();
    await audit(db, { actor, action: "media.added", targetType: ownerType, targetId: ownerId, data: { mediaId: id, widths: row!.widths, bytes: row!.bytes } });
    return row!;
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}

async function getLive(db: DB, id: string) {
  const [m] = await db.select().from(media).where(and(eq(media.id, id), isNull(media.deletedAt)));
  if (!m) throw notFound("Image not found.");
  return m;
}

export async function updateImage(db: DB, actor: Actor, id: string, input: { alt?: string; makeMain?: boolean; move?: -1 | 1 }) {
  authorize(actor, "catalogue.write");
  const m = await getLive(db, id);
  await db.transaction(async (tx) => {
    if (input.alt !== undefined) await tx.update(media).set({ alt: input.alt.trim().replace(/\s+/g, " ").slice(0, 200) }).where(eq(media.id, id));
    if (input.makeMain || input.move) {
      const list = await listMedia(tx, m.ownerType as OwnerType, [m.ownerId]);
      const order = list.map((x) => x.id);
      const at = order.indexOf(id);
      order.splice(at, 1);
      const to = input.makeMain ? 0 : Math.max(0, Math.min(order.length, at + input.move!));
      order.splice(to, 0, id);
      for (const [i, mid] of order.entries()) await tx.update(media).set({ sortOrder: i }).where(eq(media.id, mid));
    }
    await audit(tx, { actor, action: "media.updated", targetType: m.ownerType, targetId: m.ownerId, data: { mediaId: id, ...input } });
  });
}

/** Removes the files at once; the row stays (marked deleted) for the audit trail. */
export async function deleteImage(db: DB, actor: Actor, id: string) {
  authorize(actor, "catalogue.write");
  const m = await getLive(db, id);
  await db.update(media).set({ deletedAt: new Date() }).where(eq(media.id, id));
  await rm(path.dirname(fileFor(id, m.width, m.ext as Ext)), { recursive: true, force: true });
  await audit(db, { actor, action: "media.deleted", targetType: m.ownerType, targetId: m.ownerId, data: { mediaId: id } });
}

/** Reads one stored copy for the public image route. */
export async function readImage(db: DB, id: string, width: number, ext: string) {
  if (!UUID.test(id)) return null;
  const [m] = await db.select().from(media).where(and(eq(media.id, id), isNull(media.deletedAt)));
  if (!m || m.ext !== ext || !m.widths.includes(width)) return null;
  try {
    return { media: m, bytes: await readFile(fileFor(id, width, m.ext as Ext)) };
  } catch {
    return null;
  }
}

/** URL of one copy; pick with srcset in the page. */
export const imageUrl = (m: Pick<MediaRow, "id" | "ext">, width: number) => `/media/${m.id}/${width}.${m.ext}`;
