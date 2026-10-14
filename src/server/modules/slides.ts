import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { media, slides } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { notFound } from "../lib/errors";
import { audit } from "./audit";
import { mainImages } from "./media";

/**
 * Home page slides: a headline, a line of text, one button and a picture, shown in order between optional dates.
 * The text is real page text (read by screen readers and search engines), never baked into the picture.
 */
const day = z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-01.")]);
export const slideInput = z
  .object({
    headline: z.string().trim().min(3, "Write a headline.").max(120),
    body: z.string().trim().max(300).optional().default(""),
    ctaLabel: z.string().trim().max(40).optional().default(""),
    // A path on this site (not "//host") or an https address.
    ctaHref: z.union([z.literal(""), z.string().trim().max(300).regex(/^(\/(?!\/)[^\s]*|https:\/\/[^\s]+)$/, "Use a page on this site (starting with /) or an https:// address.")]).optional().default(""),
    active: z.boolean().default(true),
    sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
    startsOn: day.optional().default(""),
    endsOn: day.optional().default(""),
  })
  .refine((d) => !d.ctaLabel === !d.ctaHref, { message: "Give the button both a label and a link, or neither.", path: ["ctaHref"] })
  .refine((d) => !d.startsOn || !d.endsOn || d.startsOn <= d.endsOn, { message: "The end date is before the start date.", path: ["endsOn"] });

export async function listSlides(db: DB) {
  return db.select().from(slides).orderBy(asc(slides.sortOrder), asc(slides.createdAt));
}

export async function getSlide(db: DB, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [row] = await db.select().from(slides).where(eq(slides.id, id));
  return row ?? null;
}

/** Ghana uses GMT all year, so the UTC date is the local date. */
export const today = (now = new Date()) => now.toISOString().slice(0, 10);

/** Slides to show now, in order, each with its main picture (if any). */
export async function liveSlides(db: DB, now = new Date()) {
  const d = today(now);
  const rows = (await db.select().from(slides).where(eq(slides.active, true)).orderBy(asc(slides.sortOrder), asc(slides.createdAt))).filter(
    (s) => (!s.startsOn || s.startsOn <= d) && (!s.endsOn || s.endsOn >= d),
  );
  const pics = await mainImages(db, "slide", rows.map((r) => r.id));
  return rows.map((s) => ({ ...s, image: pics.get(s.id) ?? null }));
}

/** Shown in admin: whether a slide is on the home page today, and if not, why. */
export function slideStatus(s: { active: boolean; startsOn: string | null; endsOn: string | null }, now = new Date()) {
  const d = today(now);
  if (!s.active) return "hidden" as const;
  if (s.startsOn && s.startsOn > d) return "scheduled" as const;
  if (s.endsOn && s.endsOn < d) return "ended" as const;
  return "live" as const;
}

export async function saveSlide(db: DB, actor: Actor, id: string | null, input: z.input<typeof slideInput>) {
  authorize(actor, "catalogue.write");
  const d = slideInput.parse(input);
  return db.transaction(async (tx) => {
    let before = null;
    if (id) {
      [before] = await tx.select().from(slides).where(eq(slides.id, id));
      if (!before) throw notFound("Slide not found.");
    }
    const values = {
      headline: d.headline,
      body: d.body || null,
      ctaLabel: d.ctaLabel || null,
      ctaHref: d.ctaHref || null,
      active: d.active,
      sortOrder: d.sortOrder,
      startsOn: d.startsOn || null,
      endsOn: d.endsOn || null,
    };
    const [row] = id ? await tx.update(slides).set(values).where(eq(slides.id, id)).returning() : await tx.insert(slides).values(values).returning();
    await audit(tx, { actor, action: id ? "slide.updated" : "slide.created", targetType: "slide", targetId: row!.id, data: { before, after: values } });
    return row!;
  });
}

/** Swaps a slide with its neighbour, renumbering all slides 0, 10, 20… so the order stays tidy. */
export async function moveSlide(db: DB, actor: Actor, id: string, dir: -1 | 1) {
  authorize(actor, "catalogue.write");
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(slides).orderBy(asc(slides.sortOrder), asc(slides.createdAt));
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) throw notFound("Slide not found.");
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    for (const [n, r] of rows.entries()) if (r.sortOrder !== n * 10) await tx.update(slides).set({ sortOrder: n * 10 }).where(eq(slides.id, r.id));
    await audit(tx, { actor, action: "slide.moved", targetType: "slide", targetId: id, data: { dir } });
  });
}

export async function deleteSlide(db: DB, actor: Actor, id: string) {
  authorize(actor, "catalogue.write");
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(slides).where(eq(slides.id, id));
    if (!s) throw notFound("Slide not found.");
    await tx.update(media).set({ deletedAt: new Date() }).where(and(eq(media.ownerType, "slide"), eq(media.ownerId, id), isNull(media.deletedAt)));
    await tx.delete(slides).where(eq(slides.id, id));
    await audit(tx, { actor, action: "slide.deleted", targetType: "slide", targetId: id, data: { headline: s.headline } });
  });
}
