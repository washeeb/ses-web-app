import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { listMedia } from "@/server/modules/media";
import { deleteSlide, listSlides, liveSlides, moveSlide, saveSlide, slideInput, slideStatus } from "@/server/modules/slides";
import { installStarterImages } from "@/server/modules/starter-images";
import { SERVICE_AREAS } from "@/content/site";

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
    expect(await listSlides(db)).toHaveLength(5);
  });
});
