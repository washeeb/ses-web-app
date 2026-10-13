import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { categories, products } from "@/server/db/schema";
import { addImage, checkUploadSet, deleteImage, inspectImage, listMedia, mediaRoot, readImage, updateImage } from "@/server/modules/media";
import { createProduct, getStoreProduct, listStoreProducts, updateProduct } from "@/server/modules/catalogue";
import { deleteBrand, deleteCategory, listTags, parseSpecs, parseTagNames, renameTag, saveBrand, saveCategory } from "@/server/modules/taxonomy";

let db: DB;
let close: () => Promise<void>;
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ses-media-"));
  process.env.UPLOAD_DIR = dir;
  ({ db, close } = await setupDb());
});
afterAll(async () => {
  await close();
  await rm(dir, { recursive: true, force: true });
});
const as = (email: string) => actorFor(db, email, true);

// Minimal file headers: enough for type and size detection.
function png(w: number, h: number) {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function webp(w: number, h: number) {
  const b = Buffer.alloc(40);
  b.write("RIFF", 0, "latin1");
  b.writeUInt32LE(32, 4);
  b.write("WEBPVP8X", 8, "latin1");
  b.writeUIntLE(w - 1, 24, 3);
  b.writeUIntLE(h - 1, 27, 3);
  return b;
}
function jpeg(w: number, h: number) {
  // SOI, APP0 (16 bytes), SOF0 with height/width.
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(h, 5);
  sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)]);
}

describe("image checks", () => {
  it("identify JPEG, PNG and WebP by content and read their size", () => {
    expect(inspectImage(png(640, 480))).toEqual({ ext: "png", width: 640, height: 480 });
    expect(inspectImage(webp(1600, 900))).toEqual({ ext: "webp", width: 1600, height: 900 });
    expect(inspectImage(jpeg(800, 600))).toEqual({ ext: "jpg", width: 800, height: 600 });
    expect(inspectImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(inspectImage(Buffer.from("GIF89a................................"))).toBeNull();
  });
  it("refuse mislabelled, mixed, oversized or foreign files", () => {
    expect(() => checkUploadSet({ files: [{ width: 800, bytes: webp(320, 200) }], alt: "" })).toThrow(/does not match/);
    expect(() => checkUploadSet({ files: [{ width: 320, bytes: webp(320, 200) }, { width: 800, bytes: jpeg(800, 500) }], alt: "" })).toThrow(/same type/);
    expect(() => checkUploadSet({ files: [{ width: 5000, bytes: png(5000, 10) }], alt: "" })).toThrow(/at most/);
    expect(() => checkUploadSet({ files: [{ width: 20, bytes: Buffer.from("%PDF-1.7 not an image at all....") }], alt: "" })).toThrow(/JPEG, PNG or WebP/);
    expect(() => checkUploadSet({ files: [], alt: "" })).toThrow(/Choose/);
    const ok = checkUploadSet({ files: [{ width: 800, bytes: webp(800, 450) }, { width: 320, bytes: webp(320, 180) }], alt: "  A   router  " });
    expect(ok.copies.map((c) => c.width)).toEqual([320, 800]);
    expect(ok.alt).toBe("A router");
  });
});

describe("pictures", () => {
  it("are stored outside the app, served by id and width, reordered and removed", async () => {
    const store = await as("procurement@ses.demo");
    const { product } = await createProduct(db, store, { name: "Picture test router", type: "hardware" }, { name: "Std", priceMinor: 100 });
    const a = await addImage(db, store, "product", product.id, { files: [{ width: 320, bytes: webp(320, 240) }, { width: 800, bytes: webp(800, 600) }], alt: "Front" });
    const b = await addImage(db, store, "product", product.id, { files: [{ width: 640, bytes: jpeg(640, 480) }], alt: "Back" });
    expect(mediaRoot().startsWith(dir)).toBe(true);
    expect((await readdir(path.join(mediaRoot(), a.id.slice(0, 2), a.id))).sort()).toEqual(["320.webp", "800.webp"]);
    expect((await readImage(db, a.id, 800, "webp"))!.bytes.length).toBeGreaterThan(0);
    expect(await readImage(db, a.id, 1600, "webp")).toBeNull();
    expect(await readImage(db, a.id, 800, "png")).toBeNull();
    expect(await readImage(db, "../../etc/passwd", 800, "webp")).toBeNull();
    expect((await listMedia(db, "product", [product.id])).map((m) => m.alt)).toEqual(["Front", "Back"]);
    await updateImage(db, store, b.id, { makeMain: true });
    expect((await listMedia(db, "product", [product.id])).map((m) => m.alt)).toEqual(["Back", "Front"]);
    await deleteImage(db, store, b.id);
    expect(await readImage(db, b.id, 640, "jpg")).toBeNull();
    expect((await listMedia(db, "product", [product.id])).map((m) => m.alt)).toEqual(["Front"]);
    // Auditors can look but not upload.
    await expect(addImage(db, await as("auditor@ses.demo"), "product", product.id, { files: [{ width: 320, bytes: png(320, 320) }], alt: "" })).rejects.toThrow();
  });
});

describe("categories, brands, tags and specifications", () => {
  it("keep sub-categories one level deep and protect categories in use", async () => {
    const store = await as("procurement@ses.demo");
    const parent = await saveCategory(db, store, null, { name: "Printers & ink", skuCode: "prn" });
    expect(parent).toMatchObject({ slug: "printers-ink", skuCode: "PRN", active: true });
    const child = await saveCategory(db, store, null, { name: "Ink cartridges", parentId: parent.id });
    await expect(saveCategory(db, store, null, { name: "Too deep", parentId: child.id })).rejects.toThrow(/one level/);
    await expect(saveCategory(db, store, parent.id, { name: "Printers & ink", parentId: parent.id })).rejects.toThrow(/itself/);
    const twin = await saveCategory(db, store, null, { name: "Printers & ink" });
    expect(twin.slug).toBe("printers-ink-2");
    const { product, variant } = await createProduct(db, store, { name: "HP 305 black", type: "hardware", categoryId: child.id, status: "active" }, { name: "Std", priceMinor: 9_000 });
    expect(variant.sku).toMatch(/^SE-INK-\d{5}$/); // a sub-category without its own code uses its slug
    // Filtering by the parent includes its sub-category's products.
    expect((await listStoreProducts(db, { category: "printers-ink" })).map((p) => p.id)).toContain(product.id);
    await expect(deleteCategory(db, store, child.id)).rejects.toThrow(/Move it first/);
    await expect(deleteCategory(db, store, parent.id)).rejects.toThrow(/sub-categories/);
    await deleteCategory(db, store, twin.id);
    expect(await db.select().from(categories).where(eq(categories.id, twin.id))).toHaveLength(0);
  });

  it("filter the shop by brand and tag, search brands and SKUs, and show specs", async () => {
    const store = await as("procurement@ses.demo");
    const brand = await saveBrand(db, store, null, { name: "TP-Link", website: "https://www.tp-link.com" });
    const { product, variant } = await createProduct(
      db,
      store,
      { name: "Archer router", type: "hardware", brandId: brand.id, status: "active", tagsText: "Wireless, wifi 6, wireless", specsText: "Speed: AX1800\n\nPorts: 4 × gigabit" },
      { name: "Std", priceMinor: 70_000 },
    );
    expect((await listStoreProducts(db, { brand: "tp-link" })).map((p) => p.id)).toEqual([product.id]);
    expect((await listStoreProducts(db, { tag: "wifi-6" })).map((p) => p.id)).toEqual([product.id]);
    expect((await listStoreProducts(db, { q: "tp-link" })).map((p) => p.id)).toContain(product.id);
    expect((await listStoreProducts(db, { q: variant.sku })).map((p) => p.id)).toEqual([product.id]);
    expect(await listStoreProducts(db, { brand: "no-such-brand" })).toEqual([]);
    const shown = (await getStoreProduct(db, product.slug))!;
    expect(shown.specs).toEqual([{ name: "Speed", value: "AX1800" }, { name: "Ports", value: "4 × gigabit" }]);
    expect(shown.tags.map((t) => t.name)).toEqual(["wifi 6", "Wireless"]);
    expect(shown.brandName).toBe("TP-Link");
    // Tags are replaced on save; renaming a tag changes it everywhere.
    await updateProduct(db, store, product.id, { name: "Archer router", type: "hardware", brandId: brand.id, status: "active", tagsText: "wireless" });
    const wireless = (await listTags(db)).find((t) => t.slug === "wireless")!;
    await renameTag(db, store, wireless.id, "Wi-Fi");
    expect((await getStoreProduct(db, product.slug))!.tags.map((t) => t.name)).toEqual(["Wi-Fi"]);
    await expect(deleteBrand(db, store, brand.id)).rejects.toThrow(/uses this brand/);
    await db.update(products).set({ brandId: null }).where(eq(products.id, product.id));
    await deleteBrand(db, store, brand.id);
  });

  it("parse specification lines and tag lists strictly", () => {
    expect(parseSpecs("Resolution: 4 MP\nLens:2.8 mm\n\n")).toEqual([{ name: "Resolution", value: "4 MP" }, { name: "Lens", value: "2.8 mm" }]);
    expect(() => parseSpecs("no colon here")).toThrow(/Resolution: 4 MP/);
    expect(parseTagNames(" a , A, b\nc ").map((t) => t.slug)).toEqual(["a", "b", "c"]);
    expect(() => parseTagNames(Array.from({ length: 16 }, (_, i) => `t${i}`).join(","))).toThrow(/15/);
  });
});
