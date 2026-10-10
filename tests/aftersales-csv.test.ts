import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { approvalRequests, notifications, orders, productVariants, returnRequests, stockLevels, stockLocations, stockMovements, users, warranties } from "@/server/db/schema";
import { acceptQuote, confirmOrder, createQuote, fulfilOrder, sendQuote, submitQuote } from "@/server/modules/sales";
import { cancelReturn, decideReturn, getReturn, receiveReturn, requestReturn, completeReturn } from "@/server/modules/returns";
import { decideApproval } from "@/server/modules/approvals";
import { listNotifications, markRead, unreadCount } from "@/server/modules/notifications";
import { applyProductImport, csvCell, exportCsv, parseCsv, previewProductImport } from "@/server/modules/csv";

let db: DB;
let close: () => Promise<void>;
let orgs: Awaited<ReturnType<typeof setupDb>>["organizations"];
beforeAll(async () => ({ db, close, organizations: orgs } = await setupDb()));
afterAll(() => close());

const variant = async (sku: string) => (await db.select().from(productVariants).where(eq(productVariants.sku, sku)))[0]!;

/** Sells `qty` of a SKU to customer A and delivers it. */
async function deliveredOrder(sku: string, qty: number) {
  const sales = await actorFor(db, "sales@ses.demo");
  const q = await createQuote(db, sales, { customerOrgId: orgs.custA.id, discountBp: 1000, lines: [{ variantId: (await variant(sku)).id, quantity: qty }] });
  await submitQuote(db, sales, q.id);
  if ((await db.select().from(approvalRequests).where(and(eq(approvalRequests.subjectId, q.id), eq(approvalRequests.status, "pending")))).length) {
    const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, q.id));
    await decideApproval(db, await actorFor(db, "finance@ses.demo"), req!.id, true, "");
  }
  await sendQuote(db, sales, q.id);
  const order = await acceptQuote(db, await actorFor(db, "buyer.admin@customer-a.demo"), q.id);
  const wh = await actorFor(db, "warehouse@ses.demo");
  await confirmOrder(db, wh, order.id);
  await fulfilOrder(db, wh, order.id);
  return (await db.select().from(orders).where(eq(orders.id, order.id)))[0]!;
}

describe("warranties", () => {
  it("start on fulfilment for products with a warranty period", async () => {
    const laptop = await variant("SES-LAP14-I5-16");
    await db.update(productVariants).set({ warrantyMonths: 12 }).where(eq(productVariants.id, laptop.id));
    const order = await deliveredOrder("SES-LAP14-I5-16", 2);
    expect(order.fulfilledAt).not.toBeNull();
    const [w] = await db.select().from(warranties).where(eq(warranties.orderId, order.id));
    expect(w!.quantity).toBe(2);
    const months = (w!.endsAt.getUTCFullYear() - w!.startsAt.getUTCFullYear()) * 12 + w!.endsAt.getUTCMonth() - w!.startsAt.getUTCMonth();
    expect(months).toBe(12);
  });
});

describe("returns and refunds", () => {
  it("customer requests → staff approves → receives with restock → refund needs someone else's approval", async () => {
    const order = await deliveredOrder("SES-LAP14-I5-16", 2);
    const buyer = await actorFor(db, "buyer.admin@customer-a.demo");
    const lines = await db.query.orderLines.findMany({ where: (l, { eq }) => eq(l.orderId, order.id) });

    await expect(requestReturn(db, buyer, { orderId: order.id, kind: "return", resolution: "refund", reason: "Ordered the wrong model", lines: [{ orderLineId: lines[0]!.id, quantity: 3 }] })).rejects.toThrow(/Only 2/);
    const rma = await requestReturn(db, buyer, { orderId: order.id, kind: "return", resolution: "refund", reason: "Ordered the wrong model", lines: [{ orderLineId: lines[0]!.id, quantity: 1 }] });
    expect(rma.number).toMatch(/^RMA-\d{4}-\d{5}$/);

    // Other customers cannot see it.
    await expect(getReturn(db, await actorFor(db, "admin@customer-b.demo"), rma.id)).rejects.toMatchObject({ code: "not_found" });
    // Staff were notified.
    const salesUser = await actorFor(db, "sales@ses.demo");
    expect((await listNotifications(db, salesUser)).some((n) => n.title.includes(rma.number))).toBe(true);

    const support = await actorFor(db, "support@ses.demo");
    await expect(decideReturn(db, support, rma.id, false, "")).rejects.toThrow(/reason/);
    await decideReturn(db, support, rma.id, true, "");

    const wh = await actorFor(db, "warehouse@ses.demo");
    const loc = (await db.select().from(stockLocations).where(eq(stockLocations.code, "ACC-MAIN")))[0]!;
    const before = (await db.select().from(stockLevels).where(and(eq(stockLevels.variantId, lines[0]!.variantId!), eq(stockLevels.locationId, loc.id))))[0]!.onHand;
    await receiveReturn(db, wh, rma.id, { restock: true, locationId: loc.id });
    const after = (await db.select().from(stockLevels).where(and(eq(stockLevels.variantId, lines[0]!.variantId!), eq(stockLevels.locationId, loc.id))))[0]!.onHand;
    expect(after).toBe(before + 1);
    expect((await db.select().from(stockMovements).where(and(eq(stockMovements.reason, "return"), eq(stockMovements.refId, rma.id)))).length).toBe(1);

    const [r] = await db.select().from(returnRequests).where(eq(returnRequests.id, rma.id));
    expect(r!.status).toBe("refund_pending");
    // Refund = one unit's share of what was paid: 12,500 less 10% discount plus 20% taxes = 13,500.
    expect(r!.refundMinor).toBe(1_350_000);

    const [req] = await db.select().from(approvalRequests).where(and(eq(approvalRequests.type, "refund"), eq(approvalRequests.subjectId, rma.id)));
    // The person who received it cannot approve; neither can someone without refunds.approve.
    await expect(decideApproval(db, wh, req!.id, true, "")).rejects.toMatchObject({ code: "forbidden" });
    await expect(decideApproval(db, await actorFor(db, "sales.manager@ses.demo"), req!.id, true, "")).rejects.toMatchObject({ code: "forbidden" });
    await decideApproval(db, await actorFor(db, "finance@ses.demo"), req!.id, true, "Refund via bank transfer");
    expect((await db.select().from(returnRequests).where(eq(returnRequests.id, rma.id)))[0]!.status).toBe("completed");
    // Customer users were told.
    expect((await listNotifications(db, buyer)).some((n) => n.title.includes("refund approved"))).toBe(true);

    // The remaining unit can still be returned; the returned one cannot be claimed twice.
    await expect(requestReturn(db, buyer, { orderId: order.id, kind: "return", resolution: "refund", reason: "Second one too please", lines: [{ orderLineId: lines[0]!.id, quantity: 2 }] })).rejects.toThrow(/Only 1/);
  });

  it("enforces the return window but allows warranty claims after it, and replacement completes without refund approval", async () => {
    const order = await deliveredOrder("SES-LAP14-I5-16", 1);
    const lines = await db.query.orderLines.findMany({ where: (l, { eq }) => eq(l.orderId, order.id) });
    const buyer = await actorFor(db, "buyer.admin@customer-a.demo");
    const later = new Date(order.fulfilledAt!.getTime() + 30 * 86_400_000);
    await expect(requestReturn(db, buyer, { orderId: order.id, kind: "return", resolution: "refund", reason: "No longer needed", lines: [{ orderLineId: lines[0]!.id, quantity: 1 }] }, later)).rejects.toThrow(/return window/);
    const claim = await requestReturn(db, buyer, { orderId: order.id, kind: "warranty", resolution: "repair", reason: "Screen flickers after a month", lines: [{ orderLineId: lines[0]!.id, quantity: 1 }] }, later);
    const support = await actorFor(db, "support@ses.demo");
    await decideReturn(db, support, claim.id, true, "Bring it to the service desk");
    await receiveReturn(db, support, claim.id, { restock: false });
    await completeReturn(db, support, claim.id, "Display replaced under warranty");
    expect((await db.select().from(returnRequests).where(eq(returnRequests.id, claim.id)))[0]!.status).toBe("completed");
  });

  it("non-warranty items cannot be claimed under warranty; customer users can withdraw", async () => {
    const order = await deliveredOrder("SES-SVC-ERP-DISC", 1);
    const lines = await db.query.orderLines.findMany({ where: (l, { eq }) => eq(l.orderId, order.id) });
    const buyer = await actorFor(db, "buyer@customer-a.demo");
    await expect(requestReturn(db, buyer, { orderId: order.id, kind: "warranty", resolution: "repair", reason: "Workshop was not useful", lines: [{ orderLineId: lines[0]!.id, quantity: 1 }] })).rejects.toThrow(/not under warranty/);
    const r = await requestReturn(db, buyer, { orderId: order.id, kind: "return", resolution: "refund", reason: "Booked by mistake, please cancel", lines: [{ orderLineId: lines[0]!.id, quantity: 1 }] });
    await cancelReturn(db, buyer, r.id);
    expect((await db.select().from(returnRequests).where(eq(returnRequests.id, r.id)))[0]!.status).toBe("cancelled");
  });
});

describe("notifications", () => {
  it("approvers are notified of new requests, never the requester; read state is per user", async () => {
    const sales = await actorFor(db, "sales@ses.demo");
    const q = await createQuote(db, sales, { customerOrgId: orgs.custA.id, discountBp: 3000, lines: [{ variantId: (await variant("SES-SVC-ITA-STD")).id, quantity: 1 }] });
    await submitQuote(db, sales, q.id);
    const finance = await actorFor(db, "finance@ses.demo");
    const forFinance = (await listNotifications(db, finance)).filter((n) => n.title.includes("Quotation awaiting"));
    expect(forFinance.length).toBeGreaterThan(0);
    expect((await listNotifications(db, sales)).some((n) => n.title.includes("Quotation awaiting"))).toBe(false);
    const before = await unreadCount(db, finance);
    await markRead(db, finance, forFinance[0]!.id);
    expect(await unreadCount(db, finance)).toBe(before - 1);
    // Marking someone else's notification does nothing.
    const [other] = await db.select().from(notifications).where(eq(notifications.userId, (await db.select().from(users).where(eq(users.email, "exec@ses.demo")))[0]!.id));
    await markRead(db, finance, other!.id);
    expect((await db.select().from(notifications).where(eq(notifications.id, other!.id)))[0]!.readAt).toBeNull();
  });
});

describe("CSV", () => {
  it("neutralises spreadsheet formulas and quotes properly", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell("+233 20 000")).toBe("'+233 20 000");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"']]);
  });

  it("exports need data.export and audit; partners and HR cannot export", async () => {
    const exec = await actorFor(db, "exec@ses.demo");
    const out = await exportCsv(db, exec, "orders");
    expect(out.csv.split("\r\n")[0]).toContain("number,created_at,customer");
    await expect(exportCsv(db, await actorFor(db, "hr@ses.demo"), "orders")).rejects.toMatchObject({ code: "forbidden" });
    await expect(exportCsv(db, await actorFor(db, "procurement@ses.demo"), "returns")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("round-trips products: preview changes nothing, apply creates/updates and routes big price rises to approval", async () => {
    const proc = await actorFor(db, "procurement@ses.demo");
    const exported = (await exportCsv(db, proc, "products")).csv;
    const rows = parseCsv(exported);
    const head = rows[0]!;
    const idx = (c: string) => head.indexOf(c);
    const office = rows.find((r) => r[idx("sku")] === "SES-OFFICE-USR-Y")!;
    office[idx("price_ghs")] = "3000.00"; // was 1,650 → +82% → approval
    office[idx("warranty_months")] = "0";
    const newRow = [...office];
    newRow[idx("sku")] = "SES-OFFICE-USR-M";
    newRow[idx("variant_name")] = "Per user · monthly";
    newRow[idx("price_ghs")] = "150.00";
    newRow[idx("billing_period")] = "month";
    const bad = [...office];
    bad[idx("sku")] = "x";
    const text = [head, office, newRow, bad].map((r) => r.map((c) => (c.includes(",") ? `"${c}"` : c)).join(",")).join("\n");

    const preview = await previewProductImport(db, proc, text);
    expect(preview.map((p) => p.action).sort()).toEqual(["add_option", "error", "update"]);
    expect((await variant("SES-OFFICE-USR-Y")).priceMinor).toBe(165_000);

    const res = await applyProductImport(db, proc, text);
    expect(res).toMatchObject({ created: 1, updated: 1, skipped: 1, approvals: 1 });
    expect((await variant("SES-OFFICE-USR-Y")).priceMinor).toBe(165_000); // held for approval
    expect((await variant("SES-OFFICE-USR-M")).billingPeriod).toBe("month");
    await expect(previewProductImport(db, await actorFor(db, "sales@ses.demo"), text)).rejects.toMatchObject({ code: "forbidden" });
  });
});
