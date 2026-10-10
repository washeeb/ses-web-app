import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { approvalRequests, documents, jobs, mailOutbox, productVariants, purchaseOrders, rateLimits, sessions, stockLevels, stockLocations, stockMovements, users } from "@/server/db/schema";
import { createPurchaseOrder, receiveGoods, saveSupplier, sendPurchaseOrder, submitPurchaseOrder, cancelPurchaseOrder } from "@/server/modules/procurement";
import { decideApproval } from "@/server/modules/approvals";
import { adjustStock } from "@/server/modules/inventory";
import { contentDisposition, deleteDocument, listDocuments, readDocument, sanitizeFileName, uploadDocument } from "@/server/modules/documents";
import { acceptQuote, confirmOrder, createQuote, fulfilOrder, sendQuote, submitQuote } from "@/server/modules/sales";
import { runMaintenance } from "@/server/modules/maintenance";

let db: DB;
let close: () => Promise<void>;
let orgs: Awaited<ReturnType<typeof setupDb>>["organizations"];
const uploadDir = mkdtempSync(path.join(tmpdir(), "ses-uploads-"));

beforeAll(async () => {
  process.env.UPLOAD_DIR = uploadDir;
  ({ db, close, organizations: orgs } = await setupDb());
});
afterAll(async () => {
  await close();
  rmSync(uploadDir, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

const variant = async (sku: string) => (await db.select().from(productVariants).where(eq(productVariants.sku, sku)))[0]!;
const warehouse = async () => (await db.select().from(stockLocations).where(eq(stockLocations.code, "ACC-MAIN")))[0]!;
const level = async (variantId: string, locationId: string) =>
  (await db.select().from(stockLevels).where(and(eq(stockLevels.variantId, variantId), eq(stockLevels.locationId, locationId))))[0];

describe("procurement", () => {
  it("runs supplier → PO → approval (not by the creator) → send (e-mail) → partial and full receipt into stock", async () => {
    const proc = await actorFor(db, "procurement@ses.demo");
    const supplierId = await saveSupplier(db, proc, null, { name: "Test Supplier Ltd", email: "orders@supplier.example", paymentTermsDays: 30 });
    const laptop = await variant("SES-LAP14-I5-16");
    const loc = await warehouse();
    const before = (await level(laptop.id, loc.id))!.onHand;

    const po = await createPurchaseOrder(db, proc, {
      supplierId,
      locationId: loc.id,
      lines: [
        { variantId: laptop.id, quantity: 10, unitCostMinor: 900_000 }, // GHS 90,000 → above GHS 20,000 limit
        { variantId: null, description: "Delivery and handling", quantity: 1, unitCostMinor: 50_000 },
      ],
    });
    expect(po.totalMinor).toBe(9_050_000);
    expect(await submitPurchaseOrder(db, proc, po.id)).toBe("pending_approval");
    const [req] = await db.select().from(approvalRequests).where(and(eq(approvalRequests.subjectId, po.id), eq(approvalRequests.status, "pending")));

    // Warehouse cannot approve; finance needs MFA; then finance approves.
    await expect(decideApproval(db, await actorFor(db, "warehouse@ses.demo"), req!.id, true, "")).rejects.toMatchObject({ code: "forbidden" });
    await expect(decideApproval(db, await actorFor(db, "finance@ses.demo", false), req!.id, true, "")).rejects.toMatchObject({ code: "mfa_required" });
    await decideApproval(db, await actorFor(db, "finance@ses.demo"), req!.id, true, "Budgeted");

    expect((await sendPurchaseOrder(db, proc, po.id)).emailed).toBe(true);
    const [mail] = await db.select().from(mailOutbox).where(eq(mailOutbox.to, "orders@supplier.example"));
    expect(mail!.subject).toContain(po.number);

    const wh = await actorFor(db, "warehouse@ses.demo");
    const full = await db.query.purchaseOrderLines.findMany({ where: (l, { eq }) => eq(l.purchaseOrderId, po.id) });
    const laptopLine = full.find((l) => l.variantId === laptop.id)!;
    const otherLine = full.find((l) => l.variantId === null)!;

    await expect(receiveGoods(db, wh, po.id, { lines: [{ lineId: laptopLine.id, quantity: 11 }] })).rejects.toThrow(/only 10 outstanding/);
    const r1 = await receiveGoods(db, wh, po.id, { lines: [{ lineId: laptopLine.id, quantity: 4 }] });
    expect(r1.complete).toBe(false);
    expect((await level(laptop.id, loc.id))!.onHand).toBe(before + 4);
    expect((await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id)))[0]!.status).toBe("partially_received");

    const r2 = await receiveGoods(db, wh, po.id, { lines: [{ lineId: laptopLine.id, quantity: 6 }, { lineId: otherLine.id, quantity: 1 }] });
    expect(r2.complete).toBe(true);
    expect((await level(laptop.id, loc.id))!.onHand).toBe(before + 10);
    const moves = await db.select().from(stockMovements).where(and(eq(stockMovements.variantId, laptop.id), eq(stockMovements.reason, "receipt")));
    expect(moves.map((m) => m.quantity).sort()).toEqual([4, 6]);
    await expect(cancelPurchaseOrder(db, proc, po.id, "too late")).rejects.toThrow(/no longer be cancelled/);
  });

  it("small orders are auto-approved; the creator can never approve their own", async () => {
    const proc = await actorFor(db, "procurement@ses.demo");
    const supplierId = await saveSupplier(db, proc, null, { name: "Small Supplier" });
    const po = await createPurchaseOrder(db, proc, { supplierId, locationId: (await warehouse()).id, lines: [{ variantId: null, description: "Cables", quantity: 5, unitCostMinor: 2_000 }] });
    expect(await submitPurchaseOrder(db, proc, po.id)).toBe("approved");
    expect((await sendPurchaseOrder(db, proc, po.id)).emailed).toBe(false);
    // Sales cannot raise purchase orders at all.
    await expect(createPurchaseOrder(db, await actorFor(db, "sales@ses.demo"), { supplierId, locationId: (await warehouse()).id, lines: [{ description: "x", quantity: 1, unitCostMinor: 1 }] })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("stock ledger", () => {
  it("records manual adjustments and fulfilment of SES stock", async () => {
    const srv = await variant("SES-SRV1U-STD");
    const loc = await warehouse();
    await adjustStock(db, await actorFor(db, "warehouse@ses.demo"), { variantId: srv.id, locationId: loc.id, onHand: 5, reason: "Cycle count" });
    const sales = await actorFor(db, "sales@ses.demo");
    const q = await createQuote(db, sales, { customerOrgId: orgs.custA.id, discountBp: 0, lines: [{ variantId: (await variant("SES-LAP14-I7-32")).id, quantity: 1 }] });
    await submitQuote(db, sales, q.id);
    await sendQuote(db, sales, q.id);
    const order = await acceptQuote(db, await actorFor(db, "buyer.admin@customer-a.demo"), q.id);
    const wh = await actorFor(db, "warehouse@ses.demo");
    await confirmOrder(db, wh, order.id);
    await fulfilOrder(db, wh, order.id);
    const reasons = (await db.select().from(stockMovements)).map((m) => `${m.reason}:${m.quantity}`);
    expect(reasons).toContain("adjustment:3"); // 2 → 5
    expect(reasons).toContain("fulfilment:-1");
  });
});

describe("documents", () => {
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
  let orderId: string;

  beforeAll(async () => {
    const sales = await actorFor(db, "sales@ses.demo");
    const q = await createQuote(db, sales, { customerOrgId: orgs.custA.id, discountBp: 0, lines: [{ variantId: (await variant("SES-SVC-ERP-DISC")).id, quantity: 1 }] });
    await submitQuote(db, sales, q.id);
    await sendQuote(db, sales, q.id);
    orderId = (await acceptQuote(db, await actorFor(db, "buyer.admin@customer-a.demo"), q.id)).id;
  });

  it("checks content, not just the extension, and rejects dangerous types", async () => {
    const sales = await actorFor(db, "sales@ses.demo");
    const up = (fileName: string, bytes: Buffer) => uploadDocument(db, sales, { entityType: "order", entityId: orderId, fileName, bytes, visibility: "internal" });
    await expect(up("invoice.pdf", Buffer.from("<html><script>alert(1)</script></html>"))).rejects.toThrow(/do not match/);
    await expect(up("logo.svg", Buffer.from("<svg/>"))).rejects.toThrow(/not allowed/);
    await expect(up("page.html", Buffer.from("<html/>"))).rejects.toThrow(/not allowed/);
    await expect(up("big.pdf", Buffer.concat([pdf, Buffer.alloc(9 * 1024 * 1024)]))).rejects.toThrow(/8 MB/);
    await expect(up("notes.txt", Buffer.from([0x41, 0x00, 0x42]))).rejects.toThrow(/do not match/);
    const ok = await up("../../etc/Delivery note.pdf", pdf);
    expect(ok.fileName).toBe("Delivery note.pdf");
    expect(ok.storageKey).toMatch(/^[a-f0-9]{48}$/);
    // Stored under a random name inside UPLOAD_DIR only.
    expect(readdirSync(path.join(uploadDir, ok.storageKey.slice(0, 2)))).toContain(ok.storageKey);
  });

  it("customers see only documents shared with them, and only for their own organisation", async () => {
    const sales = await actorFor(db, "sales@ses.demo");
    const shared = await uploadDocument(db, sales, { entityType: "order", entityId: orderId, fileName: "Signed quote.pdf", bytes: pdf, visibility: "customer" });
    const internal = await uploadDocument(db, sales, { entityType: "order", entityId: orderId, fileName: "Margin notes.txt", bytes: Buffer.from("internal margin 30%"), visibility: "internal" });

    const custA = await actorFor(db, "buyer@customer-a.demo");
    expect((await listDocuments(db, custA, "order", orderId)).map((r) => r.d.fileName)).toEqual(["Signed quote.pdf"]);
    expect((await readDocument(db, custA, shared.id)).bytes.equals(pdf)).toBe(true);
    await expect(readDocument(db, custA, internal.id)).rejects.toMatchObject({ code: "not_found" });

    const custB = await actorFor(db, "admin@customer-b.demo");
    expect(await listDocuments(db, custB, "order", orderId)).toEqual([]);
    await expect(readDocument(db, custB, shared.id)).rejects.toMatchObject({ code: "not_found" });

    // Staff without access to orders cannot download either; HR has no documents.read.
    await expect(readDocument(db, await actorFor(db, "hr@ses.demo"), internal.id)).rejects.toMatchObject({ code: "not_found" });
    // Partners never see customer documents.
    await expect(readDocument(db, await actorFor(db, "partner.admin@kingsview.demo"), shared.id)).rejects.toMatchObject({ code: "not_found" });

    // Supplier/PO documents can never be shared with customers.
    const proc = await actorFor(db, "procurement@ses.demo");
    const supplierId = await saveSupplier(db, proc, null, { name: "Doc Supplier" });
    const supDoc = await uploadDocument(db, proc, { entityType: "supplier", entityId: supplierId, fileName: "contract.pdf", bytes: pdf, visibility: "customer" });
    expect(supDoc.visibility).toBe("internal");

    await deleteDocument(db, sales, shared.id);
    await expect(readDocument(db, custA, shared.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(uploadDocument(db, custA as never, { entityType: "order", entityId: orderId, fileName: "x.pdf", bytes: pdf, visibility: "internal" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("produces safe download headers", () => {
    expect(sanitizeFileName('..\\..\\a<b>"c|d?.pdf')).toBe("abcd.pdf");
    expect(contentDisposition('Rapport "été".pdf')).toBe(`attachment; filename="Rapport _${"_"}t__.pdf"; filename*=UTF-8''Rapport%20%22%C3%A9t%C3%A9%22.pdf`);
  });
});

describe("maintenance", () => {
  it("removes expired sessions, stale rate limits, finished jobs and long-deleted document files", async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 400 * 86_400_000);
    const [u] = await db.select().from(users).limit(1);
    await db.insert(sessions).values({ userId: u!.id, tokenHash: "old-session-hash", expiresAt: old, lastSeenAt: old });
    await db.insert(rateLimits).values({ key: "old-window", windowStart: old, count: 3 });
    await db.insert(jobs).values({ type: "x", status: "done", completedAt: old });
    const [doc] = await db.select().from(documents).limit(1);
    await db.update(documents).set({ deletedAt: old }).where(eq(documents.id, doc!.id));
    const counts = await runMaintenance(db, now);
    expect(counts.sessions).toBeGreaterThanOrEqual(1);
    expect(counts.rateLimits).toBeGreaterThanOrEqual(1);
    expect(counts.jobs).toBeGreaterThanOrEqual(1);
    expect(counts.documents).toBe(1);
    expect(await db.select().from(documents).where(eq(documents.id, doc!.id))).toEqual([]);
  });
});
