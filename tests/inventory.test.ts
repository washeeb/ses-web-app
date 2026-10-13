import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { notifications, productVariants, stockLevels, stockLocations, stockMovements, stockSerials, warranties } from "@/server/db/schema";
import {
  checkLowStock,
  completeCount,
  createTransfer,
  defaultLocationId,
  dispatchTransfer,
  receiveStock,
  receiveTransfer,
  recordAdjustment,
  recordCounts,
  reorderList,
  saveLocation,
  scanIntoCount,
  searchSerials,
  startCount,
  stockOverview,
  updateStockSettings,
} from "@/server/modules/inventory";
import { createProduct } from "@/server/modules/catalogue";
import { createPurchaseOrder, draftOrdersFromReorder, getPurchaseOrder, receiveGoods, saveSupplier, sendPurchaseOrder, submitPurchaseOrder } from "@/server/modules/procurement";
import { acceptQuote, confirmOrder, createQuote, fulfilOrder, sendQuote, submitQuote } from "@/server/modules/sales";

let db: DB;
let close: () => Promise<void>;
let orgs: Awaited<ReturnType<typeof setupDb>>["organizations"];
beforeAll(async () => ({ db, close, organizations: orgs } = await setupDb()));
afterAll(async () => close());

const as = (email: string) => actorFor(db, email, true);
const variant = async (sku: string) => (await db.select().from(productVariants).where(eq(productVariants.sku, sku)))[0]!;
const level = async (variantId: string, locationId: string) => (await db.select().from(stockLevels).where(and(eq(stockLevels.variantId, variantId), eq(stockLevels.locationId, locationId))))[0];
let main: string;
let quarantine: string;
let partnerLoc: string;

describe("locations", () => {
  it("keep one default and refuse any manual change to partner stock", async () => {
    const admin = await as("admin@ses.demo");
    main = await defaultLocationId(db);
    quarantine = (await saveLocation(db, admin, null, { code: "ACC-QUAR", name: "Quarantine shelf", kind: "other", sellable: false, isDefault: false, active: true })).id;
    const [p] = await db.insert(stockLocations).values({ code: "TEST-PARTNER", name: "Partner (test)", organizationId: orgs.kingsview.id, connectionId: "00000000-0000-4000-8000-0000000000aa", kind: "partner" }).returning();
    partnerLoc = p!.id;
    const wh = await as("warehouse@ses.demo");
    const lap = await variant("SES-LAP14-I5-16");
    await expect(receiveStock(db, wh, { variantId: lap.id, locationId: partnerLoc, quantity: 1 })).rejects.toThrow(/partner feed/);
    await expect(recordAdjustment(db, wh, { variantId: lap.id, locationId: partnerLoc, reason: "found", quantity: 1, note: "Should fail" })).rejects.toThrow(/partner feed/);
    await expect(saveLocation(db, admin, partnerLoc, { code: "TEST-PARTNER", name: "Partner renamed", kind: "other", sellable: true, isDefault: false, active: true })).rejects.toThrow(/partner connection/);
    await expect(saveLocation(db, admin, main, { code: "ACC-MAIN", name: "Accra main warehouse", kind: "warehouse", sellable: true, isDefault: false, active: true })).rejects.toThrow(/one default/);
  });
});

describe("goods receipt and average cost", () => {
  it("updates stock and the weighted average cost from the purchase order", async () => {
    const proc = await as("procurement@ses.demo");
    const lap = await variant("SES-LAP14-I5-16");
    const onHand = (await level(lap.id, main))!.onHand;
    const supplierId = await saveSupplier(db, proc, null, { name: "Laptop Distributor GH", email: "sales@laptops.example", paymentTermsDays: 30 });
    const po = await createPurchaseOrder(db, proc, { supplierId, locationId: main, lines: [{ variantId: lap.id, quantity: onHand, unitCostMinor: 900_000 }] });
    const status = await submitPurchaseOrder(db, proc, po.id);
    if (status === "pending_approval") {
      const { decideApproval } = await import("@/server/modules/approvals");
      const { approvalRequests } = await import("@/server/db/schema");
      const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, po.id));
      await decideApproval(db, await as("exec@ses.demo"), req!.id, true, "OK");
    }
    await sendPurchaseOrder(db, proc, po.id);
    const line = (await getPurchaseOrder(db, proc, po.id)).lines[0]!.line;
    await receiveGoods(db, await as("warehouse@ses.demo"), po.id, { lines: [{ lineId: line.id, quantity: onHand }] });
    expect((await level(lap.id, main))!.onHand).toBe(onHand * 2);
    expect((await variant("SES-LAP14-I5-16")).costMinor).toBe(900_000); // first costed receipt sets the average
    const [m] = await db.select().from(stockMovements).where(and(eq(stockMovements.variantId, lap.id), eq(stockMovements.refType, "goods_receipt")));
    expect(m!.unitCostMinor).toBe(900_000);
    await receiveStock(db, await as("warehouse@ses.demo"), { variantId: lap.id, quantity: onHand * 2, unitCostMinor: 1_100_000 });
    expect((await variant("SES-LAP14-I5-16")).costMinor).toBe(1_000_000);
  });
});

describe("adjustments, quarantine and transfers", () => {
  it("record reasons, keep non-sellable stock out of sale, and move stock between locations", async () => {
    const wh = await as("warehouse@ses.demo");
    const lap = await variant("SES-LAP14-I5-16");
    const before = (await stockOverview(db, wh, { q: "SES-LAP14-I5-16" }))[0]!.available;
    const t = await createTransfer(db, wh, { fromLocationId: main, toLocationId: quarantine, lines: [{ variantId: lap.id, quantity: 2 }] });
    await dispatchTransfer(db, wh, t.id);
    await receiveTransfer(db, wh, t.id);
    expect((await level(lap.id, quarantine))!.onHand).toBe(2);
    expect((await stockOverview(db, wh, { q: "SES-LAP14-I5-16" }))[0]!.available).toBe(before - 2);
    await recordAdjustment(db, wh, { variantId: lap.id, locationId: quarantine, reason: "damaged", quantity: 2, note: "Cracked screens on arrival" });
    expect((await level(lap.id, quarantine))!.onHand).toBe(0);
    await expect(recordAdjustment(db, wh, { variantId: lap.id, locationId: main, reason: "lost", quantity: 1, note: "x" })).rejects.toThrow(/what happened/);
    await expect(createTransfer(db, wh, { fromLocationId: main, toLocationId: partnerLoc, lines: [{ variantId: lap.id, quantity: 1 }] })).rejects.toThrow(/partner feed/);
  });
});

describe("serial numbers and warranties", () => {
  it("are received, required on fulfilment, and recorded on the customer's warranty", async () => {
    const proc = await as("procurement@ses.demo");
    const wh = await as("warehouse@ses.demo");
    const { variant: fw } = await createProduct(db, proc, { name: "Next-gen firewall", type: "hardware", status: "active" }, { name: "Std", priceMinor: 2_500_000, warrantyMonths: 12 });
    expect(fw.sku).toMatch(/^SE-GEN-\d{5}$/);
    await updateStockSettings(db, proc, fw.id, { barcode: "", reorderPoint: 1, reorderQty: 2, leadTimeDays: 14, serialTracked: true });
    await expect(receiveStock(db, wh, { variantId: fw.id, quantity: 2, serials: "FW-001" })).rejects.toThrow(/one serial number per unit/);
    await receiveStock(db, wh, { variantId: fw.id, quantity: 2, serials: "fw-001 FW-002", unitCostMinor: 1_800_000 });
    const sales = await as("sales@ses.demo");
    const q = await createQuote(db, sales, { customerOrgId: orgs.custA.id, discountBp: 0, lines: [{ variantId: fw.id, quantity: 1 }] });
    await submitQuote(db, sales, q.id);
    await sendQuote(db, sales, q.id);
    const order = await acceptQuote(db, await as("buyer.admin@customer-a.demo"), q.id);
    await confirmOrder(db, wh, order.id);
    await expect(fulfilOrder(db, wh, order.id)).rejects.toThrow(/serial numbers/);
    await fulfilOrder(db, wh, order.id, { [fw.id]: ["FW-002"] });
    expect((await db.select().from(stockSerials).where(eq(stockSerials.serial, "FW-002")))[0]).toMatchObject({ status: "sold", orderId: order.id });
    const [w] = await db.select().from(warranties).where(eq(warranties.orderId, order.id));
    expect(w!.serials).toEqual(["FW-002"]);
    expect((await searchSerials(db, wh, "fw-00")).map((s) => [s.s.serial, s.s.status])).toEqual([["FW-001", "in_stock"], ["FW-002", "sold"]]);
  });
});

describe("stocktakes, alerts and reorder drafts", () => {
  it("post differences, alert once at the reorder point, and draft purchase orders per supplier", async () => {
    const wh = await as("warehouse@ses.demo");
    const proc = await as("procurement@ses.demo");
    const srv = await variant("SES-SRV1U-STD");
    const onHand = (await level(srv.id, main))!.onHand;
    const c = await startCount(db, wh, { locationId: main, blind: true });
    for (let i = 0; i < onHand + 1; i++) await scanIntoCount(db, wh, c.id, "ses-srv1u-std");
    await recordCounts(db, wh, c.id, []);
    const r = await completeCount(db, wh, c.id);
    expect(r.changed).toBe(1);
    expect((await level(srv.id, main))!.onHand).toBe(onHand + 1);
    const supplierId = await saveSupplier(db, proc, null, { name: "Server Supplier", paymentTermsDays: 30 });
    await updateStockSettings(db, proc, srv.id, { barcode: "0123456789012", reorderPoint: onHand + 5, reorderQty: 3, leadTimeDays: 10, serialTracked: false, preferredSupplierId: supplierId });
    expect((await reorderList(db, wh)).map((x) => x.sku)).toContain("SES-SRV1U-STD");
    const before = (await db.select().from(notifications)).length;
    expect((await checkLowStock(db)).alerted).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(notifications)).length).toBeGreaterThan(before);
    expect((await checkLowStock(db)).alerted).toBe(0);
    const drafts = await draftOrdersFromReorder(db, proc);
    const po = await getPurchaseOrder(db, proc, drafts.created.find((d) => d)!.id);
    expect(po.lines.some((l) => l.sku === "SES-SRV1U-STD")).toBe(true);
    // Scanning by barcode finds the item too.
    const c2 = await startCount(db, wh, { locationId: main });
    expect((await scanIntoCount(db, wh, c2.id, "0123456789012")).sku).toBe("SES-SRV1U-STD");
  });
});
