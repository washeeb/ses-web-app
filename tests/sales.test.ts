import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { approvalRequests, leads, orders, productVariants, stockLevels, stockLocations } from "@/server/db/schema";
import { computeTotals } from "@/server/lib/money";
import { acceptQuote, cancelOrder, confirmOrder, createEnquiry, createQuote, fulfilOrder, getQuote, listQuotes, sendQuote, submitQuote } from "@/server/modules/sales";
import { decideApproval } from "@/server/modules/approvals";
import { requestPriceChange } from "@/server/modules/catalogue";
import { adjustStock } from "@/server/modules/inventory";

let db: DB;
let close: () => Promise<void>;
let orgs: Awaited<ReturnType<typeof setupDb>>["organizations"];
beforeAll(async () => ({ db, close, organizations: orgs } = await setupDb()));
afterAll(() => close());

const variant = async (sku: string) => (await db.select().from(productVariants).where(eq(productVariants.sku, sku)))[0]!;

async function sentQuote(lines: { sku: string; qty: number }[], discountBp = 0, customer = orgs.custA.id) {
  const sales = await actorFor(db, "sales@ses.demo");
  const q = await createQuote(db, sales, {
    customerOrgId: customer,
    discountBp,
    lines: await Promise.all(lines.map(async (l) => ({ variantId: (await variant(l.sku)).id, quantity: l.qty }))),
  });
  const status = await submitQuote(db, sales, q.id);
  if (status === "approved") await sendQuote(db, sales, q.id);
  return { q, status };
}

/** Submits, gets finance approval if needed, and sends. */
async function openQuote(lines: { sku: string; qty: number }[]) {
  const r = await sentQuote(lines);
  if (r.status === "pending_approval") {
    const [req] = await db.select().from(approvalRequests).where(and(eq(approvalRequests.subjectId, r.q.id), eq(approvalRequests.status, "pending")));
    await decideApproval(db, await actorFor(db, "finance@ses.demo"), req!.id, true, "");
    await sendQuote(db, await actorFor(db, "sales@ses.demo"), r.q.id);
  }
  return r;
}

describe("totals", () => {
  it("applies discount before tax and only taxes taxable lines", () => {
    const t = computeTotals({
      lines: [
        { quantity: 2, unitPriceMinor: 10_000, taxable: true },
        { quantity: 1, unitPriceMinor: 5_000, taxable: false },
      ],
      discountBp: 1000,
      taxes: [
        { code: "A", name: "A", rateBp: 1500, compound: false },
        { code: "B", name: "B", rateBp: 250, compound: false },
      ],
    });
    expect(t.subtotalMinor).toBe(25_000);
    expect(t.discountMinor).toBe(2_500);
    expect(t.taxMinor).toBe(2_700 + 450); // 18,000 taxable after discount
    expect(t.totalMinor).toBe(25_000 - 2_500 + 3_150);
  });
});

describe("lead to sale", () => {
  it("creates a lead from a public enquiry and rejects spam honeypots", async () => {
    const r = await createEnquiry(db, { contactName: "Test Person", email: "t@example.com", message: "We need a network upgrade for 3 sites." }, "7.7.7.7");
    expect(r.number).toMatch(/^L-\d{4}-\d{5}$/);
    await expect(createEnquiry(db, { contactName: "Bot", email: "b@example.com", message: "spam spam spam spam", website: "http://spam" }, "7.7.7.8")).rejects.toThrow();
    const [lead] = await db.select().from(leads).where(eq(leads.number, r.number));
    expect(lead!.departmentId).not.toBeNull();
  });
});

describe("quotation approval", () => {
  it("auto-approves small quotes and holds large ones for someone else", async () => {
    const small = await sentQuote([{ sku: "SES-SVC-ERP-DISC", qty: 1 }]);
    expect(small.status).toBe("approved");

    const big = await sentQuote([{ sku: "SES-SVC-CYB-RR", qty: 2 }]); // GHS 64,000 + tax
    expect(big.status).toBe("pending_approval");
    const [req] = await db.select().from(approvalRequests).where(and(eq(approvalRequests.subjectId, big.q.id), eq(approvalRequests.status, "pending")));

    // A sales manager without quotes.approve cannot decide.
    await expect(decideApproval(db, await actorFor(db, "sales.manager@ses.demo"), req!.id, true, "")).rejects.toMatchObject({ code: "forbidden" });
    // Finance without MFA cannot decide (privileged).
    await expect(decideApproval(db, await actorFor(db, "finance@ses.demo", false), req!.id, true, "")).rejects.toMatchObject({ code: "mfa_required" });
    await decideApproval(db, await actorFor(db, "finance@ses.demo"), req!.id, true, "Within budget");
    expect((await getQuote(db, await actorFor(db, "sales@ses.demo"), big.q.id)).status).toBe("approved");
  });

  it("blocks self-approval even for someone holding the approve permission (and in the database)", async () => {
    const exec = await actorFor(db, "exec@ses.demo");
    const sales = await actorFor(db, "sales@ses.demo");
    const q = await createQuote(db, sales, { customerOrgId: orgs.custA.id, discountBp: 2500, lines: [{ variantId: (await variant("SES-SVC-ITA-STD")).id, quantity: 1 }] });
    await submitQuote(db, sales, q.id);
    const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, q.id));
    // DB check constraint: decided_by may never equal requested_by.
    await expect(db.update(approvalRequests).set({ decidedBy: sales.userId }).where(eq(approvalRequests.id, req!.id))).rejects.toThrow();
    await decideApproval(db, exec, req!.id, false, "Discount too deep");
    expect((await getQuote(db, sales, q.id)).status).toBe("rejected");
  });
});

describe("customer acceptance and stock", () => {
  it("hides drafts and other customers' quotes; accepting creates an order and reserves stock", async () => {
    const { q } = await openQuote([{ sku: "SES-LAP14-I7-32", qty: 3 }]);
    const custB = await actorFor(db, "admin@customer-b.demo");
    await expect(getQuote(db, custB, q.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(acceptQuote(db, custB, q.id)).rejects.toMatchObject({ code: "not_found" });
    const custUser = await actorFor(db, "buyer@customer-a.demo");
    await expect(acceptQuote(db, custUser, q.id)).rejects.toMatchObject({ code: "forbidden" });
    expect((await listQuotes(db, custUser)).every((r) => r.quote.customerOrgId === orgs.custA.id)).toBe(true);

    const order = await acceptQuote(db, await actorFor(db, "buyer.admin@customer-a.demo"), q.id);
    const v = await variant("SES-LAP14-I7-32");
    const [lvl] = await db.select().from(stockLevels).where(eq(stockLevels.variantId, v.id));
    expect(lvl!.reserved).toBe(3);
    expect(lvl!.onHand).toBe(4);

    const warehouse = await actorFor(db, "warehouse@ses.demo");
    await expect(adjustStock(db, warehouse, { variantId: v.id, locationId: lvl!.locationId, onHand: 2, reason: "count" })).rejects.toThrow(/reserved/);
    await confirmOrder(db, warehouse, order.id);
    await fulfilOrder(db, warehouse, order.id);
    const [after] = await db.select().from(stockLevels).where(eq(stockLevels.variantId, v.id));
    expect(after).toMatchObject({ onHand: 1, reserved: 0 });
  });

  it("never oversells: the second acceptance of the last unit fails and leaves nothing behind", async () => {
    const sku = "SES-SRV1U-STD"; // 2 in stock
    const a = await openQuote([{ sku, qty: 2 }]);
    const b = await openQuote([{ sku, qty: 1 }]);
    const buyer = await actorFor(db, "buyer.admin@customer-a.demo");
    const results = await Promise.allSettled([acceptQuote(db, buyer, a.q.id), acceptQuote(db, buyer, b.q.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(failed.reason.message)).toMatch(/Not enough confirmed stock/);
    const [lvl] = await db.select().from(stockLevels).where(eq(stockLevels.variantId, (await variant(sku)).id));
    expect(lvl!.reserved).toBeLessThanOrEqual(lvl!.onHand);
    // The failed acceptance rolled back completely: its quote is still open.
    const failedQuoteId = results[0]!.status === "rejected" ? a.q.id : b.q.id;
    expect((await getQuote(db, buyer, failedQuoteId)).status).toBe("sent");
  });

  it("cancelling releases reservations", async () => {
    const { q } = await openQuote([{ sku: "SES-LAP14-I5-16", qty: 5 }]);
    const order = await acceptQuote(db, await actorFor(db, "buyer.admin@customer-a.demo"), q.id);
    await cancelOrder(db, await actorFor(db, "sales@ses.demo"), order.id, "Customer changed scope");
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.status).toBe("cancelled");
    const [lvl] = await db
      .select()
      .from(stockLevels)
      .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
      .where(eq(stockLevels.variantId, (await variant("SES-LAP14-I5-16")).id));
    expect(lvl!.stock_levels.reserved).toBe(0);
  });
});

describe("price changes", () => {
  it("small changes apply; large ones need another person's approval", async () => {
    const proc = await actorFor(db, "procurement@ses.demo");
    const v = await variant("SES-OFFICE-USR-Y"); // 165,000
    expect((await requestPriceChange(db, proc, v.id, 170_000, "supplier uplift")).applied).toBe(true);
    const r = await requestPriceChange(db, proc, v.id, 250_000, "new edition");
    expect(r.applied).toBe(false);
    expect((await variant("SES-OFFICE-USR-Y")).priceMinor).toBe(170_000);
    await decideApproval(db, await actorFor(db, "finance@ses.demo"), r.approvalId!, true, "");
    expect((await variant("SES-OFFICE-USR-Y")).priceMinor).toBe(250_000);
  });
});
