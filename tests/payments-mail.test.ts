import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { jobs, mailOutbox, orders, payments, productVariants, stockReservations, taxRates } from "@/server/db/schema";
import { acceptQuote, createQuote, sendQuote, submitQuote } from "@/server/modules/sales";
import { receivePaystackWebhook, startPaystackCheckout, verifyAndApplyPayment, type FetchLike } from "@/server/modules/payments/paystack";
import { deliverMail, sendMail } from "@/server/modules/mail";

const SECRET = "sk_test_unittestsecret123";
let db: DB;
let close: () => Promise<void>;
let orgs: Awaited<ReturnType<typeof setupDb>>["organizations"];

beforeAll(async () => {
  process.env.PAYSTACK_SECRET_KEY = SECRET;
  ({ db, close, organizations: orgs } = await setupDb());
});
afterAll(async () => {
  delete process.env.PAYSTACK_SECRET_KEY;
  await close();
});

async function newOrder() {
  const sales = await actorFor(db, "sales@ses.demo");
  const [v] = await db.select().from(productVariants).where(eq(productVariants.sku, "SES-SVC-ERP-DISC"));
  const q = await createQuote(db, sales, { customerOrgId: orgs.custA.id, discountBp: 0, lines: [{ variantId: v!.id, quantity: 1 }] });
  await submitQuote(db, sales, q.id);
  await sendQuote(db, sales, q.id);
  return acceptQuote(db, await actorFor(db, "buyer.admin@customer-a.demo"), q.id);
}

/** Fake Paystack API: records calls and answers verify with the given outcome. */
function fakePaystack(verify: { status: string; amount?: number; currency?: string }) {
  const calls: { url: string; body?: unknown }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith("/transaction/initialize")) {
      return { ok: true, status: 200, json: async () => ({ status: true, data: { authorization_url: "https://checkout.paystack.com/abc123", reference: "x" } }) };
    }
    return { ok: true, status: 200, json: async () => ({ status: true, data: { id: 987, channel: "mobile_money", paid_at: new Date().toISOString(), ...verify } }) };
  };
  return { f, calls };
}

const sign = (body: string) => createHmac("sha512", SECRET).update(body).digest("hex");

describe("Ghana standard taxes", () => {
  it("seeds VAT 15%, NHIL 2.5%, GETFund 2.5%, not compounded", async () => {
    const rows = await db.select().from(taxRates);
    expect(rows.map((r) => [r.code, r.rateBp, r.compound, r.isDemo]).sort()).toEqual([
      ["GETFUND", 250, false, false],
      ["NHIL", 250, false, false],
      ["VAT", 1500, false, false],
    ]);
  });
});

describe("Paystack payments", () => {
  it("starts checkout with the order total in pesewas and GHS, only for the customer's own order", async () => {
    const order = await newOrder();
    const { f, calls } = fakePaystack({ status: "success" });
    const url = await startPaystackCheckout(db, await actorFor(db, "buyer.admin@customer-a.demo"), order.id, "https://synclyticsenterprisesystems.com", f);
    expect(url).toBe("https://checkout.paystack.com/abc123");
    expect(calls[0]!.body).toMatchObject({ amount: order.totalMinor, currency: "GHS", email: "buyer.admin@customer-a.demo" });
    // Customer User (no pay permission) and another customer cannot start payment.
    await expect(startPaystackCheckout(db, await actorFor(db, "buyer@customer-a.demo"), order.id, "x", f)).rejects.toMatchObject({ code: "forbidden" });
    await expect(startPaystackCheckout(db, await actorFor(db, "admin@customer-b.demo"), order.id, "x", f)).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects unsigned/forged webhooks and queues verified ones once", async () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "SES-REF-1" } });
    expect((await receivePaystackWebhook(db, body, null)).status).toBe(401);
    expect((await receivePaystackWebhook(db, body, "deadbeef")).status).toBe(401);
    expect((await receivePaystackWebhook(db, body, sign(body))).status).toBe(200);
    expect((await receivePaystackWebhook(db, body, sign(body))).status).toBe(200);
    expect(await db.select().from(jobs).where(eq(jobs.dedupeKey, "paystack:charge.success:SES-REF-1"))).toHaveLength(1);
  });

  it("marks the order paid only after Paystack verifies amount and currency; idempotent", async () => {
    const order = await newOrder();
    const buyer = await actorFor(db, "buyer.admin@customer-a.demo");
    const ok = fakePaystack({ status: "success", amount: order.totalMinor, currency: "GHS" });
    await startPaystackCheckout(db, buyer, order.id, "x", ok.f);
    const [p] = await db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(p!.mode).toBe("test");
    expect(await verifyAndApplyPayment(db, p!.reference, fakePaystack({ status: "pending" }).f)).toBe("not_successful");
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.paymentStatus).toBe("unpaid");
    expect(await verifyAndApplyPayment(db, p!.reference, ok.f)).toBe("applied");
    expect(await verifyAndApplyPayment(db, p!.reference, ok.f)).toBe("already_applied");
    const [o] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(o!.paymentStatus).toBe("paid");
    // Paid orders keep their stock hold (no expiry).
    const holds = await db.select().from(stockReservations).where(eq(stockReservations.orderId, order.id));
    expect(holds.every((h) => h.expiresAt === null)).toBe(true);
    await expect(startPaystackCheckout(db, buyer, order.id, "x", ok.f)).rejects.toThrow(/already paid/);
  });

  it("does not mark paid when the amount differs", async () => {
    const order = await newOrder();
    const f = fakePaystack({ status: "success", amount: 100, currency: "GHS" });
    await startPaystackCheckout(db, await actorFor(db, "buyer.admin@customer-a.demo"), order.id, "x", f.f);
    const [p] = await db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(await verifyAndApplyPayment(db, p!.reference, f.f)).toBe("amount_mismatch");
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.paymentStatus).toBe("unpaid");
  });
});

describe("e-mail delivery", () => {
  it("queues mail, sends via SMTP transport and erases the body after sending", async () => {
    process.env.MAIL_ADAPTER = "smtp";
    try {
      await sendMail(db, { to: "someone@example.com", subject: "Test", body: "secret link https://x/reset?token=abc" });
    } finally {
      process.env.MAIL_ADAPTER = "console";
    }
    const [m] = await db.select().from(mailOutbox).where(eq(mailOutbox.to, "someone@example.com"));
    const sent: unknown[] = [];
    // A failing transport records the error and throws so the job queue retries.
    await expect(deliverMail(db, { id: m!.id }, { sendMail: async () => { throw new Error("SMTP 421"); } })).rejects.toThrow("SMTP 421");
    expect((await db.select().from(mailOutbox).where(eq(mailOutbox.id, m!.id)))[0]!.lastError).toBe("SMTP 421");
    await deliverMail(db, { id: m!.id }, { sendMail: async (x) => { sent.push(x); } });
    expect(sent).toHaveLength(1);
    const [after] = await db.select().from(mailOutbox).where(eq(mailOutbox.id, m!.id));
    expect(after!.sentAt).not.toBeNull();
    expect(after!.body).not.toContain("token");
  });
});

describe("Data Protection Commission reminder", () => {
  it("reports missing, expiring (≤60 days), expired and valid registrations", async () => {
    const { dpcStatus } = await import("@/server/modules/settings");
    const now = new Date("2026-10-10T12:00:00Z");
    expect(dpcStatus({ dpcRegistrationNumber: "", dpcRegistrationExpires: "" }, now).state).toBe("missing");
    expect(dpcStatus({ dpcRegistrationNumber: "DPC-1", dpcRegistrationExpires: "2026-11-30" }, now)).toMatchObject({ state: "expiring", daysLeft: 51 });
    expect(dpcStatus({ dpcRegistrationNumber: "DPC-1", dpcRegistrationExpires: "2026-10-01" }, now).state).toBe("expired");
    expect(dpcStatus({ dpcRegistrationNumber: "DPC-1", dpcRegistrationExpires: "2028-10-01" }, now).state).toBe("valid");
  });
});
