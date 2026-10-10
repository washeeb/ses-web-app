import { and, desc, eq } from "drizzle-orm";
import { createHmac } from "node:crypto";
import type { DB } from "../../db/client";
import { orders, payments } from "../../db/schema";
import { authorize, can, type Actor } from "../../authz/policy";
import { randomToken, safeEqual } from "../../lib/crypto";
import { conflict, invalid, notFound } from "../../lib/errors";
import { log } from "../../lib/log";
import { audit } from "../audit";
import { publish } from "../events";
import { enqueue } from "../jobs";
import { clearReservationExpiry } from "../inventory";

/**
 * Paystack (cards and mobile money, GHS). Only test keys (sk_test_…) are expected until SES goes live.
 * Payment truth comes from Paystack's verify API, triggered by the signed webhook or the return page —
 * never from the browser redirect alone.
 */
const API = "https://api.paystack.co";

export type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export function paystackConfig() {
  const secret = process.env.PAYSTACK_SECRET_KEY ?? "";
  if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(secret)) return null;
  return {
    secret,
    mode: secret.startsWith("sk_live_") ? ("live" as const) : ("test" as const),
    channels: (process.env.PAYSTACK_CHANNELS ?? "card,mobile_money").split(",").map((c) => c.trim()).filter(Boolean),
  };
}

const PAYABLE_ORDER_STATUSES = ["pending", "confirmed"];

export async function listPayments(db: DB, orderId: string) {
  return db.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(desc(payments.createdAt));
}

/** Starts a Paystack checkout for an order and returns the hosted payment page URL. */
export async function startPaystackCheckout(db: DB, actor: Actor, orderId: string, appUrl: string, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
  const cfg = paystackConfig();
  if (!cfg) throw invalid("Online payment is not available yet.");
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || !can(actor, "customer.orders.read", { organizationId: order.customerOrgId })) throw notFound("Order not found.");
  authorize(actor, "customer.orders.pay", { organizationId: order.customerOrgId });
  if (!PAYABLE_ORDER_STATUSES.includes(order.status)) throw conflict("This order can no longer be paid online.");
  if (order.paymentStatus === "paid") throw conflict("This order is already paid.");
  if (order.currency !== "GHS") throw invalid("Online payment currently supports GHS orders only.");

  const reference = `SES-${order.number}-${randomToken(6).replace(/[^A-Za-z0-9]/g, "x")}`;
  const [payment] = await db
    .insert(payments)
    .values({ orderId, provider: "paystack", reference, amountMinor: order.totalMinor, currency: order.currency, mode: cfg.mode, initiatedBy: actor.userId })
    .returning();
  const res = await fetchImpl(`${API}/transaction/initialize`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.secret}`, "content-type": "application/json" },
    body: JSON.stringify({
      email: actor.email,
      amount: order.totalMinor, // pesewas
      currency: order.currency,
      reference,
      channels: cfg.channels,
      callback_url: `${appUrl}/portal/orders/${orderId}?payment=${encodeURIComponent(reference)}`,
      metadata: { order_number: order.number, payment_id: payment!.id },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as { status?: boolean; message?: string; data?: { authorization_url?: string } } | null;
  const url = body?.data?.authorization_url;
  if (!res.ok || !body?.status || !url || !/^https:\/\/([a-z0-9-]+\.)*paystack\.(com|co)\//.test(url)) {
    await db.update(payments).set({ status: "failed", failureReason: `initialize failed: ${body?.message ?? res.status}` }).where(eq(payments.id, payment!.id));
    log.warn("paystack.initialize_failed", { orderId, status: res.status, message: body?.message });
    throw invalid("The payment provider could not start the payment. Please try again shortly.");
  }
  await audit(db, { actor, action: "payment.initialized", targetType: "order", targetId: orderId, data: { reference, amountMinor: order.totalMinor, mode: cfg.mode } });
  return url;
}

/** HMAC-SHA512 of the raw body with the secret key, hex-encoded, in `x-paystack-signature`. */
export function verifyPaystackSignature(secret: string, rawBody: string, signature: string | null) {
  if (!signature) return false;
  return safeEqual(createHmac("sha512", secret).update(rawBody).digest("hex"), signature);
}

/** Webhook entry point: verify, queue, acknowledge. */
export async function receivePaystackWebhook(db: DB, rawBody: string, signature: string | null) {
  const cfg = paystackConfig();
  if (!cfg) return { status: 503 };
  if (!verifyPaystackSignature(cfg.secret, rawBody, signature)) {
    log.warn("paystack.signature_rejected", {});
    return { status: 401 };
  }
  let event: { event?: string; data?: { reference?: string } };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return { status: 400 };
  }
  const reference = event.data?.reference;
  if (event.event === "charge.success" && reference) {
    await enqueue(db, { type: "payment.paystack.verify", payload: { reference }, dedupeKey: `paystack:charge.success:${reference}` });
  }
  return { status: 200 };
}

/**
 * Confirms a payment with Paystack's verify endpoint and applies it once.
 * Idempotent: safe to call from the webhook job and the customer's return page.
 */
export async function verifyAndApplyPayment(db: DB, reference: string, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
  const cfg = paystackConfig();
  if (!cfg) throw new Error("Paystack is not configured");
  const [payment] = await db.select().from(payments).where(eq(payments.reference, reference));
  if (!payment) return "unknown_reference" as const;
  if (payment.status === "success") return "already_applied" as const;

  const res = await fetchImpl(`${API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { authorization: `Bearer ${cfg.secret}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Paystack verify responded ${res.status}`); // retried by the job queue
  const body = (await res.json()) as { data?: { status?: string; amount?: number; currency?: string; id?: number; channel?: string; paid_at?: string; gateway_response?: string } };
  const d = body.data ?? {};
  if (d.status !== "success") {
    if (d.status === "failed" || d.status === "abandoned") {
      await db.update(payments).set({ status: d.status, failureReason: d.gateway_response ?? null }).where(eq(payments.id, payment.id));
    }
    return "not_successful" as const;
  }
  if (d.amount !== payment.amountMinor || d.currency !== payment.currency) {
    await db.update(payments).set({ status: "amount_mismatch", failureReason: `paid ${d.amount} ${d.currency}, expected ${payment.amountMinor} ${payment.currency}` }).where(eq(payments.id, payment.id));
    await audit(db, { action: "payment.amount_mismatch", targetType: "order", targetId: payment.orderId, data: { reference, paid: d.amount, currency: d.currency } });
    return "amount_mismatch" as const;
  }

  const order = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, payment.id)).for("update");
    if (p!.status === "success") return null;
    await tx
      .update(payments)
      .set({ status: "success", providerTransactionId: d.id ? String(d.id) : null, channel: d.channel ?? null, paidAt: d.paid_at ? new Date(d.paid_at) : new Date() })
      .where(eq(payments.id, payment.id));
    const [o] = await tx
      .update(orders)
      .set({ paymentStatus: "paid", paidAt: new Date() })
      .where(and(eq(orders.id, payment.orderId), eq(orders.paymentStatus, "unpaid")))
      .returning();
    if (!o) {
      // Order was already paid by an earlier transaction: money must go back to the customer.
      await audit(tx, { action: "payment.duplicate_needs_refund", targetType: "order", targetId: payment.orderId, data: { reference, amountMinor: payment.amountMinor } });
    }
    // A paid order keeps its stock until fulfilled or cancelled.
    await clearReservationExpiry(tx, payment.orderId);
    await audit(tx, { action: "payment.succeeded", targetType: "order", targetId: payment.orderId, data: { reference, amountMinor: payment.amountMinor, channel: d.channel, mode: payment.mode } });
    return o ?? null;
  });
  if (order) publish({ topic: "orders", orgIds: [order.customerOrgId] });
  return "applied" as const;
}
