import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, count, eq } from "drizzle-orm";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { auditLog, invoiceLines, invoices, mailOutbox, notifications, orders, productVariants, stockLevels, stockReservations, users } from "@/server/db/schema";
import { cartCount, parseCart, placeStoreOrder, priceCart, requestCartQuote, setCartLine } from "@/server/modules/store";
import {
  getInvoice,
  issueInvoice,
  listInvoices,
  receivables,
  recordManualPayment,
  reverseManualPayment,
  sendInvoiceReminders,
  voidInvoice,
} from "@/server/modules/invoices";
import { acceptQuote, cancelOrder, createQuote, sendQuote, submitQuote } from "@/server/modules/sales";
import { expireReservations } from "@/server/modules/inventory";
import { startInvoicePayment, verifyAndApplyPayment, type FetchLike } from "@/server/modules/payments/paystack";

let db: DB;
let close: () => Promise<void>;
let orgs: Awaited<ReturnType<typeof setupDb>>["organizations"];
const SECRET = "sk_test_unittestsecret123";

beforeAll(async () => {
  process.env.PAYSTACK_SECRET_KEY = SECRET;
  ({ db, close, organizations: orgs } = await setupDb());
});
afterAll(async () => {
  delete process.env.PAYSTACK_SECRET_KEY;
  await close();
});

const variant = async (sku: string) => (await db.select().from(productVariants).where(eq(productVariants.sku, sku)))[0]!;
const buyerAdmin = () => actorFor(db, "buyer.admin@customer-a.demo");
const finance = (mfa = true) => actorFor(db, "finance@ses.demo", mfa);
const available = async (sku: string) => {
  const [l] = await db.select().from(stockLevels).where(eq(stockLevels.variantId, (await variant(sku)).id));
  return l!.onHand - l!.reserved;
};

async function storeOrder(lines: [string, number][], customerReference = "") {
  let cart = parseCart(null);
  for (const [sku, q] of lines) cart = setCartLine(cart, (await variant(sku)).id, q, "add");
  return placeStoreOrder(db, await buyerAdmin(), { cart, customerReference });
}

async function quoteOrder(sku = "SES-SVC-ERP-DISC") {
  const sales = await actorFor(db, "sales@ses.demo");
  const q = await createQuote(db, sales, { customerOrgId: orgs.custA.id, discountBp: 0, lines: [{ variantId: (await variant(sku)).id, quantity: 1 }] });
  await submitQuote(db, sales, q.id);
  await sendQuote(db, sales, q.id);
  return acceptQuote(db, await buyerAdmin(), q.id);
}

const invoiceOf = async (orderId: string) => (await db.select().from(invoices).where(eq(invoices.orderId, orderId)))[0]!;

describe("cart cookie", () => {
  it("treats tampered or malformed carts as empty and merges duplicate lines", () => {
    expect(parseCart("not json")).toEqual([]);
    expect(parseCart(JSON.stringify([{ v: "x", q: 1 }]))).toEqual([]);
    expect(parseCart(JSON.stringify([{ v: "7d1f6f7e-4c1a-4a54-9d55-1a2b3c4d5e6f", q: -2 }]))).toEqual([]);
    const id = "7d1f6f7e-4c1a-4a54-9d55-1a2b3c4d5e6f";
    expect(parseCart(JSON.stringify([{ v: id, q: 2 }, { v: id, q: 3 }]))).toEqual([{ v: id, q: 5 }]);
  });

  it("adds, sets and removes lines within limits", () => {
    const id = "7d1f6f7e-4c1a-4a54-9d55-1a2b3c4d5e6f";
    let c = setCartLine([], id, 2, "add");
    c = setCartLine(c, id, 3, "add");
    expect(cartCount(c)).toBe(5);
    expect(setCartLine(c, id, 0, "set")).toEqual([]);
    expect(() => setCartLine(c, id, 5000, "set")).toThrow();
    expect(() => setCartLine(c, "../etc", 1, "add")).toThrow();
  });
});

describe("store checkout", () => {
  it("prices the cart from the database with Ghana taxes", async () => {
    const priced = await priceCart(db, [{ v: (await variant("SES-LAP14-I5-16")).id, q: 2 }]);
    expect(priced.totals.subtotalMinor).toBe(2_500_000);
    expect(priced.totals.taxMinor).toBe(500_000); // VAT 15% + NHIL 2.5% + GETFund 2.5%
    expect(priced.ok).toBe(true);
  });

  it("places the order, reserves stock and issues the invoice atomically", async () => {
    const before = await available("SES-LAP14-I5-16");
    const o = await storeOrder([["SES-LAP14-I5-16", 2], ["SES-OFFICE-USR-Y", 5]], "PO-7781");
    expect(o).toMatchObject({ status: "pending", source: "store", customerReference: "PO-7781", paymentStatus: "unpaid" });
    expect(await available("SES-LAP14-I5-16")).toBe(before - 2);
    const inv = await invoiceOf(o.id);
    expect(inv).toMatchObject({ status: "issued", totalMinor: o.totalMinor, taxMinor: o.taxMinor, paidMinor: 0, customerReference: "PO-7781" });
    expect(inv.taxBreakdown.map((t) => t.code).sort()).toEqual(["GETFUND", "NHIL", "VAT"]);
    expect(await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, inv.id))).toHaveLength(2);
    // Due date follows the payment terms (14 days by default).
    expect(Math.round((inv.dueAt.getTime() - inv.issuedAt.getTime()) / 86_400_000)).toBe(14);
  });

  it("only customer administrators can order; staff and other roles cannot", async () => {
    const cart = [{ v: (await variant("SES-OFFICE-USR-Y")).id, q: 1 }];
    await expect(placeStoreOrder(db, await actorFor(db, "buyer@customer-a.demo"), { cart })).rejects.toMatchObject({ code: "forbidden" });
    await expect(placeStoreOrder(db, await actorFor(db, "sales@ses.demo"), { cart })).rejects.toMatchObject({ code: "conflict" });
  });

  it("refuses carts over the store limit, out-of-stock items and empty carts without creating anything", async () => {
    const ordersBefore = (await db.select({ n: count() }).from(orders))[0]!.n;
    await expect(storeOrder([["SES-SRV1U-STD", 1]])).rejects.toThrow(/quotation/); // GHS 58,200 incl. taxes ≥ GHS 50,000
    await expect(storeOrder([["SES-LAP14-I7-32", 50]])).rejects.toThrow(/Only 4 available/);
    await expect(placeStoreOrder(db, await buyerAdmin(), { cart: [] })).rejects.toThrow();
    const ordersAfter = (await db.select({ n: count() }).from(orders))[0]!.n;
    expect(ordersAfter).toBe(ordersBefore);
  });

  it("turns a cart into a quotation request for visitors", async () => {
    const r = await requestCartQuote(db, { contactName: "Visitor Example", email: "visitor@example.com" }, [{ v: (await variant("SES-SRV1U-STD")).id, q: 3 }], "203.0.113.9");
    expect(r.number).toMatch(/^L-\d{4}-\d{5}$/);
  });
});

describe("invoices", () => {
  it("are issued automatically when a quotation is accepted, and only the customer's own users can see them", async () => {
    const o = await quoteOrder();
    const inv = await invoiceOf(o.id);
    expect(inv.totalMinor).toBe(o.totalMinor);
    const custUser = await actorFor(db, "buyer@customer-a.demo");
    expect((await getInvoice(db, custUser, inv.id)).number).toBe(inv.number);
    await expect(getInvoice(db, await actorFor(db, "admin@customer-b.demo"), inv.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await listInvoices(db, custUser)).every((r) => r.invoice.customerOrgId === orgs.custA.id)).toBe(true);
    expect(await listInvoices(db, await actorFor(db, "admin@customer-b.demo"))).toHaveLength(0);
  });

  it("records manual payments with MFA, refuses overpayment and duplicates, and keeps the order in step", async () => {
    const o = await quoteOrder();
    const inv = await invoiceOf(o.id);
    const half = Math.floor(inv.totalMinor / 2);
    const pay = { method: "bank_transfer" as const, externalReference: "GCB-0001", paidOn: "2026-10-09" };
    await expect(recordManualPayment(db, await finance(false), inv.id, { ...pay, amountMinor: half })).rejects.toMatchObject({ code: "mfa_required" });
    await expect(recordManualPayment(db, await actorFor(db, "sales@ses.demo"), inv.id, { ...pay, amountMinor: half })).rejects.toMatchObject({ code: "forbidden" });
    await recordManualPayment(db, await finance(), inv.id, { ...pay, amountMinor: half });
    expect(await invoiceOf(o.id)).toMatchObject({ status: "part_paid", paidMinor: half });
    expect((await db.select().from(orders).where(eq(orders.id, o.id)))[0]!.paymentStatus).toBe("part_paid");
    await expect(recordManualPayment(db, await finance(), inv.id, { ...pay, amountMinor: 1 })).rejects.toThrow(/already recorded/);
    await expect(recordManualPayment(db, await finance(), inv.id, { ...pay, externalReference: "GCB-0002", amountMinor: inv.totalMinor })).rejects.toThrow(/more than the balance/);
    await recordManualPayment(db, await finance(), inv.id, { ...pay, externalReference: "MOMO-77", method: "mobile_money", amountMinor: inv.totalMinor - half });
    expect(await invoiceOf(o.id)).toMatchObject({ status: "paid", paidMinor: inv.totalMinor });
    expect((await db.select().from(orders).where(eq(orders.id, o.id)))[0]).toMatchObject({ paymentStatus: "paid" });
    expect(await receivables(db, await finance(), orgs.custA.id)).toMatchObject({ outstandingMinor: expect.any(Number) });
  });

  it("needs a second finance user to reverse a manual payment", async () => {
    const o = await quoteOrder();
    const inv = await invoiceOf(o.id);
    await recordManualPayment(db, await finance(), inv.id, { amountMinor: 10_000, method: "cash", externalReference: "RCPT-12", paidOn: "2026-10-09" });
    const { payments } = await getInvoice(db, await finance(), inv.id);
    await expect(reverseManualPayment(db, await finance(), payments[0]!.p.id, "Entered on the wrong invoice")).rejects.toMatchObject({ code: "forbidden" });
    await reverseManualPayment(db, await actorFor(db, "admin@ses.demo"), payments[0]!.p.id, "Entered on the wrong invoice");
    expect(await invoiceOf(o.id)).toMatchObject({ status: "issued", paidMinor: 0 });
  });

  it("cannot be voided with money on them; cancelling an unpaid order voids its invoice", async () => {
    const paid = await quoteOrder();
    await recordManualPayment(db, await finance(), (await invoiceOf(paid.id)).id, { amountMinor: 5_000, method: "cash", externalReference: "RCPT-99", paidOn: "2026-10-09" });
    await expect(voidInvoice(db, await finance(), (await invoiceOf(paid.id)).id, "Customer asked")).rejects.toThrow(/Payments exist/);

    const o = await quoteOrder();
    await cancelOrder(db, await actorFor(db, "sales@ses.demo"), o.id, "Customer withdrew");
    expect((await invoiceOf(o.id)).status).toBe("void");
    await expect(issueInvoice(db, await finance(), o.id)).rejects.toMatchObject({ code: "conflict" });

    // Cancelling a part-paid order keeps the invoice and tells finance a refund is due.
    await cancelOrder(db, await actorFor(db, "sales@ses.demo"), paid.id, "Customer withdrew");
    expect((await invoiceOf(paid.id)).status).toBe("part_paid");
    const [flag] = await db.select().from(auditLog).where(and(eq(auditLog.action, "invoice.refund_due"), eq(auditLog.targetId, (await invoiceOf(paid.id)).id)));
    expect(flag).toBeDefined();
  });

  it("voids the invoice when an unpaid store order's stock hold expires", async () => {
    const o = await storeOrder([["SES-LAP14-I5-16", 1]]);
    await expireReservations(db, new Date(Date.now() + 100 * 3_600_000));
    expect((await db.select().from(orders).where(eq(orders.id, o.id)))[0]!.status).toBe("expired");
    expect((await invoiceOf(o.id)).status).toBe("void");
  });

  it("are paid online for the outstanding balance; a payment after settlement is flagged for refund", async () => {
    const o = await quoteOrder();
    const inv = await invoiceOf(o.id);
    await recordManualPayment(db, await finance(), inv.id, { amountMinor: 100_000, method: "bank_transfer", externalReference: "ECO-5", paidOn: "2026-10-09" });
    const calls: { url: string; body?: { amount?: number; reference?: string; callback_url?: string } }[] = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.endsWith("/transaction/initialize")) return { ok: true, status: 200, json: async () => ({ status: true, data: { authorization_url: "https://checkout.paystack.com/xyz" } }) };
      const ref = decodeURIComponent(url.split("/").pop()!);
      const amount = refs.get(ref);
      return { ok: true, status: 200, json: async () => ({ status: true, data: { status: "success", amount, currency: "GHS", id: 1, channel: "mobile_money", paid_at: new Date().toISOString() } }) };
    };
    const refs = new Map<string, number>();
    const actor = await buyerAdmin();
    await startInvoicePayment(db, actor, inv.id, "https://example.test", f);
    await startInvoicePayment(db, actor, inv.id, "https://example.test", f); // customer opened checkout twice
    const inits = calls.filter((c) => c.url.endsWith("/initialize")).map((c) => c.body!);
    expect(inits[0]!.amount).toBe(inv.totalMinor - 100_000);
    expect(inits[0]!.callback_url).toContain(`/portal/invoices/${inv.id}`);
    for (const b of inits) refs.set(b.reference!, b.amount!);
    expect(await verifyAndApplyPayment(db, inits[0]!.reference!, f)).toBe("applied");
    expect(await invoiceOf(o.id)).toMatchObject({ status: "paid" });
    expect((await db.select().from(orders).where(eq(orders.id, o.id)))[0]!.paymentStatus).toBe("paid");
    // The second checkout is also paid: the money is kept as received, but flagged for a refund.
    expect(await verifyAndApplyPayment(db, inits[1]!.reference!, f)).toBe("applied");
    expect((await invoiceOf(o.id)).paidMinor).toBe(inv.totalMinor);
    const flagged = await db.select().from(auditLog).where(and(eq(auditLog.action, "payment.duplicate_needs_refund"), eq(auditLog.targetId, inv.id)));
    expect(flagged).toHaveLength(1);
    await expect(startInvoicePayment(db, actor, inv.id, "https://example.test", f)).rejects.toThrow(/already paid/);
  });

  it("sends overdue reminders at most once a week, up to three times", async () => {
    const o = await quoteOrder();
    const inv = await invoiceOf(o.id);
    await db.update(invoices).set({ dueAt: new Date(Date.now() - 3 * 86_400_000) }).where(eq(invoices.id, inv.id));
    const custUserId = (await db.select({ id: users.id }).from(users).where(eq(users.email, "buyer@customer-a.demo")))[0]!.id;
    const now = new Date();
    expect(await sendInvoiceReminders(db, now)).toBeGreaterThanOrEqual(1);
    const reminded = async () => (await db.select().from(notifications).where(and(eq(notifications.userId, custUserId), eq(notifications.title, `Invoice ${inv.number} is overdue`)))).length;
    expect(await reminded()).toBe(1);
    expect((await db.select().from(mailOutbox).where(eq(mailOutbox.subject, `Reminder: invoice ${inv.number} is overdue`))).length).toBeGreaterThanOrEqual(2);
    await sendInvoiceReminders(db, new Date(now.getTime() + 86_400_000));
    expect(await reminded()).toBe(1);
    for (let week = 1; week <= 4; week++) await sendInvoiceReminders(db, new Date(now.getTime() + week * 8 * 86_400_000));
    expect(await reminded()).toBe(3);
  });

  it("keeps stock held once anything is paid", async () => {
    const o = await storeOrder([["SES-LAP14-I5-16", 1]]);
    await recordManualPayment(db, await finance(), (await invoiceOf(o.id)).id, { amountMinor: 1_000, method: "cash", externalReference: "RCPT-H1", paidOn: "2026-10-09" });
    const holds = await db.select().from(stockReservations).where(eq(stockReservations.orderId, o.id));
    expect(holds.every((h) => h.expiresAt === null)).toBe(true);
  });
});
