import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { addImage, listMedia } from "@/server/modules/media";
import { deleteSlide, listSlides, liveSlides, moveSlide, saveSlide, slideInput, slideStatus } from "@/server/modules/slides";
import { installStarterImages } from "@/server/modules/starter-images";
import { SERVICE_AREAS } from "@/content/site";
import { eq } from "drizzle-orm";
import { categories } from "@/server/db/schema";

let db: DB;
let close: () => Promise<void>;
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ses-slides-"));
  process.env.UPLOAD_DIR = dir;
  ({ db, close } = await setupDb());
});
afterAll(async () => {
  await close();
  await rm(dir, { recursive: true, force: true });
});
const as = (email: string) => actorFor(db, email, true);

describe("slide rules", () => {
  it("accept site paths and https links only, and need label and link together", () => {
    const ok = (ctaHref: string, ctaLabel = "Go") => slideInput.safeParse({ headline: "Hello there", ctaLabel, ctaHref }).success;
    expect(ok("/shop")).toBe(true);
    expect(ok("https://example.com/x")).toBe(true);
    expect(ok("//evil.example")).toBe(false);
    expect(ok("javascript:alert(1)")).toBe(false);
    expect(ok("http://example.com")).toBe(false);
    expect(ok("/shop", "")).toBe(false);
    expect(slideInput.safeParse({ headline: "Dates", startsOn: "2026-10-20", endsOn: "2026-10-10" }).success).toBe(false);
  });

  it("show between their dates (inclusive), in order", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    expect(slideStatus({ active: true, startsOn: "2026-10-15", endsOn: "2026-10-15" }, now)).toBe("live");
    expect(slideStatus({ active: true, startsOn: "2026-10-16", endsOn: null }, now)).toBe("scheduled");
    expect(slideStatus({ active: true, startsOn: null, endsOn: "2026-10-14" }, now)).toBe("ended");
    expect(slideStatus({ active: false, startsOn: null, endsOn: null }, now)).toBe("hidden");
  });
});

describe("slides", () => {
  it("are created, reordered, scheduled and deleted by catalogue staff only", async () => {
    const manager = await as("procurement@ses.demo");
    await expect(saveSlide(db, await as("sales@ses.demo"), null, { headline: "Not allowed" })).rejects.toThrow();
    const a = await saveSlide(db, manager, null, { headline: "First slide", sortOrder: 0 });
    const b = await saveSlide(db, manager, null, { headline: "Second slide", sortOrder: 10, ctaLabel: "Shop", ctaHref: "/shop" });
    await saveSlide(db, manager, null, { headline: "Later", sortOrder: 20, startsOn: "2999-01-01" });
    expect((await liveSlides(db)).map((s) => s.headline)).toEqual(["First slide", "Second slide"]);
    await moveSlide(db, manager, b.id, -1);
    expect((await listSlides(db)).map((s) => s.headline).slice(0, 2)).toEqual(["Second slide", "First slide"]);
    await deleteSlide(db, manager, a.id);
    expect((await liveSlides(db)).map((s) => s.headline)).toEqual(["Second slide"]);
    for (const s of await listSlides(db)) await deleteSlide(db, manager, s.id);
  });
});

/** Enough of a PNG for type and size detection (a picture staff uploaded, not a starter one). */
function pngHeader(w: number, h: number) {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

describe("starter pictures", () => {
  it("fill empty services, categories and slides once, then leave them alone", async () => {
    const owner = await as("procurement@ses.demo");
    const first = await installStarterImages(db, owner, "assets/starter-images");
    expect(first.added.length).toBeGreaterThanOrEqual(SERVICE_AREAS.length + 6 + 5);
    const live = await liveSlides(db);
    expect(live).toHaveLength(5);
    expect(live.every((s) => s.image?.widths.join() === "320,800,1600" && s.image.ext === "webp")).toBe(true);
    expect(await listMedia(db, "service", ["managed-soc"])).toHaveLength(1);
    const again = await installStarterImages(db, owner, "assets/starter-images");
    expect(again.added).toEqual([]);
    expect(again.updated).toEqual([]);
    expect(await listSlides(db)).toHaveLength(5);
  });

  it("replace only earlier starter pictures with a newer version, never pictures staff uploaded", async () => {
    const owner = await as("procurement@ses.demo");
    const catId = async (slug: string) => (await db.select().from(categories).where(eq(categories.slug, slug)))[0]!.id;
    // Staff replace the security category picture with their own.
    const securityCat = await catId("security");
    for (const m of await listMedia(db, "category", [securityCat])) await (await import("@/server/modules/media")).deleteImage(db, owner, m.id);
    await addImage(db, owner, "category", securityCat, { files: [{ width: 1600, bytes: pngHeader(1600, 1067) }], alt: "Our own photo" });
    // A newer release: every category and slide gets a different picture, and today's become "earlier" ones.
    const dir = await mkdtemp(path.join(tmpdir(), "ses-starter-"));
    await cp("assets/starter-images", dir, { recursive: true });
    const m = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
    const installed = [...(await listMedia(db, "category", [await catId("networking")])), ...(await listMedia(db, "slide", (await listSlides(db)).map((x) => x.id)))].map((x) => x.sha256);
    m.replaceable = [...(m.replaceable ?? []), ...installed];
    const other = m.services.find((x: { slug: string }) => x.slug === "data-protection").image;
    for (const c of m.categories) c.image = other;
    for (const x of m.slides) x.image = other;
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(m));
    const r = await installStarterImages(db, owner, dir);
    expect(r.updated).toContain("category networking");
    expect(r.updated.filter((u) => u.startsWith("slide"))).toHaveLength(5);
    expect(r.skipped).toContain("category security (has its own picture)");
    expect((await listMedia(db, "category", [securityCat]))[0]!.alt).toBe("Our own photo");
    expect(await listSlides(db)).toHaveLength(5);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("starter categories", () => {
  it("are created only when asked and only when missing, then get their pictures; existing ones are untouched", async () => {
    const owner = await as("procurement@ses.demo");
    // Pretend the live store has no "networking" category yet (the demo one keeps its row under another address).
    await db.update(categories).set({ slug: "networking-old" }).where(eq(categories.slug, "networking"));
    const without = await installStarterImages(db, owner, "assets/starter-images");
    expect(without.created).toEqual([]);
    expect(without.skipped).toContain("category networking (not found)");
    const r = await installStarterImages(db, owner, "assets/starter-images", { createCategories: true });
    expect(r.created).toEqual(["category Networking"]);
    expect(r.added).toContain("category networking");
    const [made] = await db.select().from(categories).where(eq(categories.slug, "networking"));
    expect(made).toMatchObject({ name: "Networking", skuCode: "NET", active: true });
    expect((await db.select().from(categories).where(eq(categories.slug, "networking-old"))).length).toBe(1);
    expect((await installStarterImages(db, owner, "assets/starter-images", { createCategories: true })).created).toEqual([]);
  });
});
