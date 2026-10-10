import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { invoiceLines, invoices, orderLines, orders, organizations, payments, stockReservations, users } from "../db/schema";
import { authorize, can, type Actor } from "../authz/policy";
import { conflict, forbidden, invalid, notFound } from "../lib/errors";
import { formatMoney } from "../lib/money";
import { randomToken } from "../lib/crypto";
import { audit } from "./audit";
import { publish } from "./events";
import { sendMail } from "./mail";
import { announce, customerRecipients, notifyPermission, notifyUsers, usersWithPermission } from "./notifications";
import { getSettings, nextNumber } from "./settings";

const DAY = 86_400_000;
export const OPEN_STATUSES = ["issued", "part_paid"];
export const PAYMENT_METHODS = ["bank_transfer", "mobile_money", "cash", "cheque", "card"] as const;
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  cash: "Cash",
  cheque: "Cheque",
  card: "Card",
};
/** Overdue reminders: at most this many, at least this many days apart. */
const MAX_REMINDERS = 3;
const REMINDER_GAP_DAYS = 7;

type Invoice = typeof invoices.$inferSelect;

export const balanceOf = (inv: Pick<Invoice, "totalMinor" | "paidMinor">) => inv.totalMinor - inv.paidMinor;
export const isOverdue = (inv: Pick<Invoice, "status" | "dueAt">, now = new Date()) => OPEN_STATUSES.includes(inv.status) && inv.dueAt.getTime() < now.getTime();

function staffCanRead(actor: Actor) {
  return can(actor, "finance.read") || can(actor, "orders.read");
}

function assertCanSee(actor: Actor, inv: Invoice) {
  if (staffCanRead(actor)) return;
  if (can(actor, "customer.invoices.read", { organizationId: inv.customerOrgId })) return;
  throw notFound("Invoice not found.");
}

async function lockInvoice(tx: DB, id: string) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for("update");
  if (!inv) throw notFound("Invoice not found.");
  return inv;
}

// ───────────────────────────── Issuing ─────────────────────────────

/**
 * Issues the invoice for an order inside the caller's transaction. Idempotent: returns the order's
 * existing open invoice if there is one. Successful payments taken on the order before it had an
 * invoice are carried over.
 */
export async function issueInvoiceForOrder(tx: DB, orderId: string, opts: { actor: Actor | null; now?: Date }) {
  const now = opts.now ?? new Date();
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
  if (!order) throw notFound("Order not found.");
  const [existing] = await tx.select().from(invoices).where(and(eq(invoices.orderId, orderId), ne(invoices.status, "void")));
  if (existing) return existing;
  if (["cancelled", "expired"].includes(order.status)) throw conflict(`A ${order.status} order cannot be invoiced.`);
  const s = await getSettings(tx);
  const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  const earlier = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, orderId), isNull(payments.invoiceId), eq(payments.status, "success")));
  const carried = Math.min(order.totalMinor, earlier.reduce((a, p) => a + p.amountMinor, 0));
  const status = carried === 0 ? "issued" : carried >= order.totalMinor ? "paid" : "part_paid";
  const [inv] = await tx
    .insert(invoices)
    .values({
      number: await nextNumber(tx, "INV", now),
      customerOrgId: order.customerOrgId,
      orderId,
      status,
      currency: order.currency,
      subtotalMinor: order.subtotalMinor,
      discountMinor: order.discountMinor,
      taxMinor: order.taxMinor,
      totalMinor: order.totalMinor,
      taxBreakdown: order.taxBreakdown,
      paidMinor: carried,
      paidAt: status === "paid" ? now : null,
      customerReference: order.customerReference,
      issuedAt: now,
      dueAt: new Date(now.getTime() + s.invoiceDueDays * DAY),
      createdBy: opts.actor?.userId ?? null,
      isDemo: order.isDemo,
    })
    .returning();
  if (lines.length) {
    await tx.insert(invoiceLines).values(
      lines.map((l, i) => ({
        invoiceId: inv!.id,
        description: l.description,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        taxable: l.taxable,
        lineTotalMinor: l.lineTotalMinor,
        sortOrder: i,
      })),
    );
  }
  if (earlier.length) {
    await tx.update(payments).set({ invoiceId: inv!.id }).where(inArray(payments.id, earlier.map((p) => p.id)));
  }
  await syncOrderPayment(tx, inv!);
  await audit(tx, { actor: opts.actor, action: "invoice.issued", targetType: "invoice", targetId: inv!.id, data: { number: inv!.number, orderId, totalMinor: inv!.totalMinor } });
  await notifyUsers(tx, await customerRecipients(tx, "customer.invoices.read", order.customerOrgId), {
    title: `Invoice ${inv!.number} issued`,
    body: `${formatMoney(inv!.totalMinor, inv!.currency)} for order ${order.number}.`,
    link: `/portal/invoices/${inv!.id}`,
  });
  return inv!;
}

/** Staff action: (re)issue the invoice for an order that has none open. */
export async function issueInvoice(db: DB, actor: Actor, orderId: string) {
  authorize(actor, "finance.write");
  const inv = await db.transaction((tx) => issueInvoiceForOrder(tx, orderId, { actor }));
  publish({ topic: "invoices", orgIds: [inv.customerOrgId] });
  announce();
  return inv;
}

/** Keeps the order's payment status in step with its invoice. */
async function syncOrderPayment(tx: DB, inv: Invoice) {
  if (!inv.orderId) return;
  const paymentStatus = inv.status === "paid" ? "paid" : inv.paidMinor > 0 ? "part_paid" : "unpaid";
  await tx
    .update(orders)
    .set({ paymentStatus, paidAt: inv.status === "paid" ? (inv.paidAt ?? new Date()) : null })
    .where(eq(orders.id, inv.orderId));
  // Money has been received: the order keeps its stock until fulfilled or cancelled.
  if (inv.paidMinor > 0) {
    await tx
      .update(stockReservations)
      .set({ expiresAt: null })
      .where(and(eq(stockReservations.orderId, inv.orderId), eq(stockReservations.status, "active")));
  }
}

/** Adds (positive) or removes (negative, for reversals) an amount on a locked invoice. */
async function applyAmount(tx: DB, inv: Invoice, amountMinor: number, now: Date) {
  const paidMinor = inv.paidMinor + amountMinor;
  if (paidMinor < 0 || paidMinor > inv.totalMinor) throw conflict("That amount does not fit the invoice balance.");
  const status = paidMinor === 0 ? "issued" : paidMinor === inv.totalMinor ? "paid" : "part_paid";
  const [updated] = await tx
    .update(invoices)
    .set({ paidMinor, status, paidAt: status === "paid" ? now : null })
    .where(eq(invoices.id, inv.id))
    .returning();
  await syncOrderPayment(tx, updated!);
  return updated!;
}

/**
 * Applies a verified online payment (inside the caller's transaction). Returns false — and flags the
 * payment for a refund — when the invoice can no longer take it (void, already paid, or overpaid).
 */
export async function applyOnlinePayment(tx: DB, invoiceId: string, payment: { id: string; amountMinor: number; reference: string }, now = new Date()) {
  const inv = await lockInvoice(tx, invoiceId);
  if (inv.status === "void" || payment.amountMinor > balanceOf(inv)) {
    await audit(tx, { action: "payment.duplicate_needs_refund", targetType: "invoice", targetId: inv.id, data: { reference: payment.reference, amountMinor: payment.amountMinor, invoiceStatus: inv.status } });
    await notifyPermission(tx, "finance.write", {
      title: `Payment on ${inv.number} needs a refund`,
      body: `${formatMoney(payment.amountMinor, inv.currency)} (${payment.reference}) arrived after the invoice was ${inv.status === "void" ? "voided" : "settled"}.`,
      link: `/ops/invoices/${inv.id}`,
    });
    return false;
  }
  const updated = await applyAmount(tx, inv, payment.amountMinor, now);
  await notifyUsers(tx, await customerRecipients(tx, "customer.invoices.read", inv.customerOrgId), {
    title: `Payment received for ${inv.number}`,
    body: updated.status === "paid" ? "The invoice is now fully paid. Thank you." : `Balance remaining: ${formatMoney(balanceOf(updated), inv.currency)}.`,
    link: `/portal/invoices/${inv.id}`,
  });
  return true;
}

// ───────────────────────────── Manual payments ─────────────────────────────

export const manualPaymentInput = z.object({
  amountMinor: z.number().int().min(1, "Enter an amount above zero."),
  method: z.enum(["bank_transfer", "mobile_money", "cash", "cheque"]),
  externalReference: z.string().trim().min(2, "Enter the bank, mobile money or receipt reference.").max(100),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date the money was received."),
  note: z.string().trim().max(500).optional().default(""),
});

/** Finance records money received outside the online checkout. */
export async function recordManualPayment(db: DB, actor: Actor, invoiceId: string, input: z.input<typeof manualPaymentInput>, now = new Date()) {
  authorize(actor, "finance.write");
  const data = manualPaymentInput.parse(input);
  const paidAt = new Date(`${data.paidOn}T12:00:00Z`);
  if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > now.getTime() + DAY) throw invalid("The payment date cannot be in the future.");
  const inv = await db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, invoiceId);
    if (!OPEN_STATUSES.includes(inv.status)) throw conflict(`This invoice is ${inv.status}; it cannot take payments.`);
    if (data.amountMinor > balanceOf(inv)) throw conflict(`That is more than the balance of ${formatMoney(balanceOf(inv), inv.currency)}. Overpayments must be refunded, not recorded.`);
    const [dup] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.invoiceId, inv.id), eq(payments.externalReference, data.externalReference), eq(payments.status, "success")));
    if (dup) throw conflict("A payment with this reference is already recorded on this invoice.");
    const [p] = await tx
      .insert(payments)
      .values({
        orderId: inv.orderId,
        invoiceId: inv.id,
        provider: "manual",
        reference: `MAN-${inv.number}-${randomToken(4).replace(/[^A-Za-z0-9]/g, "x")}`,
        amountMinor: data.amountMinor,
        currency: inv.currency,
        status: "success",
        mode: "manual",
        method: data.method,
        externalReference: data.externalReference,
        note: data.note || null,
        recordedBy: actor.userId,
        initiatedBy: actor.userId,
        paidAt,
      })
      .returning();
    const updated = await applyAmount(tx, inv, data.amountMinor, now);
    await audit(tx, { actor, action: "payment.recorded", targetType: "invoice", targetId: inv.id, data: { paymentId: p!.id, amountMinor: data.amountMinor, method: data.method, externalReference: data.externalReference } });
    await notifyUsers(tx, await customerRecipients(tx, "customer.invoices.read", inv.customerOrgId), {
      title: `Payment received for ${inv.number}`,
      body: updated.status === "paid" ? "The invoice is now fully paid. Thank you." : `Balance remaining: ${formatMoney(balanceOf(updated), inv.currency)}.`,
      link: `/portal/invoices/${inv.id}`,
    });
    return inv;
  });
  publish({ topic: "invoices", orgIds: [inv.customerOrgId] });
  publish({ topic: "orders", orgIds: [inv.customerOrgId] });
  announce();
}

/** Corrects a manual payment recorded in error. Needs a second finance user (not the one who recorded it). */
export async function reverseManualPayment(db: DB, actor: Actor, paymentId: string, reason: string, now = new Date()) {
  authorize(actor, "finance.write");
  if (reason.trim().length < 5) throw invalid("Explain why the payment is being reversed.");
  const inv = await db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!p || !p.invoiceId) throw notFound("Payment not found.");
    if (p.provider !== "manual") throw conflict("Online payments are refunded through the payment provider, not reversed here.");
    if (p.status !== "success") throw conflict("Only recorded payments can be reversed.");
    if (p.recordedBy === actor.userId) throw forbidden("Another finance user must reverse a payment you recorded.");
    const inv = await lockInvoice(tx, p.invoiceId);
    await tx.update(payments).set({ status: "reversed", failureReason: reason.trim() }).where(eq(payments.id, p.id));
    await applyAmount(tx, inv, -p.amountMinor, now);
    await audit(tx, { actor, action: "payment.reversed", targetType: "invoice", targetId: inv.id, data: { paymentId: p.id, amountMinor: p.amountMinor, reason: reason.trim() } });
    return inv;
  });
  publish({ topic: "invoices", orgIds: [inv.customerOrgId] });
  publish({ topic: "orders", orgIds: [inv.customerOrgId] });
}

// ───────────────────────────── Voiding ─────────────────────────────

export async function voidInvoice(db: DB, actor: Actor, id: string, reason: string) {
  authorize(actor, "finance.write");
  if (reason.trim().length < 5) throw invalid("Give a reason for voiding the invoice.");
  const inv = await db.transaction(async (tx) => {
    const inv = await lockInvoice(tx, id);
    if (inv.status === "void") throw conflict("This invoice is already void.");
    if (inv.paidMinor > 0) throw conflict("Payments exist on this invoice. Reverse or refund them before voiding.");
    await tx.update(invoices).set({ status: "void", voidedAt: new Date(), voidedBy: actor.userId, voidReason: reason.trim() }).where(eq(invoices.id, id));
    await audit(tx, { actor, action: "invoice.voided", targetType: "invoice", targetId: id, data: { number: inv.number, reason: reason.trim() } });
    return inv;
  });
  publish({ topic: "invoices", orgIds: [inv.customerOrgId] });
}

/**
 * When an order is cancelled or expires: unpaid invoices are voided automatically; invoices with money
 * on them are left for finance, who are told a refund is due.
 */
export async function settleInvoicesForClosedOrder(tx: DB, orderId: string, reason: string) {
  const open = await tx.select().from(invoices).where(and(eq(invoices.orderId, orderId), ne(invoices.status, "void")));
  for (const inv of open) {
    if (inv.paidMinor === 0) {
      await tx.update(invoices).set({ status: "void", voidedAt: new Date(), voidReason: reason }).where(eq(invoices.id, inv.id));
      await audit(tx, { action: "invoice.voided", targetType: "invoice", targetId: inv.id, data: { number: inv.number, reason, automatic: true } });
    } else {
      await notifyPermission(tx, "finance.write", {
        title: `Refund due on ${inv.number}`,
        body: `The order was closed (${reason}) after ${formatMoney(inv.paidMinor, inv.currency)} was paid.`,
        link: `/ops/invoices/${inv.id}`,
      });
      await audit(tx, { action: "invoice.refund_due", targetType: "invoice", targetId: inv.id, data: { paidMinor: inv.paidMinor, reason } });
    }
  }
}

// ───────────────────────────── Reading ─────────────────────────────

export type InvoiceFilter = "open" | "overdue" | "paid" | "void" | "all";

export async function listInvoices(db: DB, actor: Actor, opts: { filter?: InvoiceFilter; customerOrgId?: string } = {}, now = new Date()) {
  const conds = [];
  if (staffCanRead(actor)) {
    if (opts.customerOrgId) conds.push(eq(invoices.customerOrgId, opts.customerOrgId));
  } else {
    authorize(actor, "customer.invoices.read", { organizationId: actor.organizationId });
    conds.push(eq(invoices.customerOrgId, actor.organizationId));
  }
  const f = opts.filter ?? "all";
  if (f === "open") conds.push(inArray(invoices.status, OPEN_STATUSES));
  if (f === "overdue") conds.push(inArray(invoices.status, OPEN_STATUSES), lt(invoices.dueAt, now));
  if (f === "paid") conds.push(eq(invoices.status, "paid"));
  if (f === "void") conds.push(eq(invoices.status, "void"));
  return db
    .select({ invoice: invoices, customerName: organizations.name, orderNumber: orders.number })
    .from(invoices)
    .innerJoin(organizations, eq(organizations.id, invoices.customerOrgId))
    .leftJoin(orders, eq(orders.id, invoices.orderId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(invoices.issuedAt))
    .limit(500);
}

export async function getInvoice(db: DB, actor: Actor, id: string) {
  const [row] = await db
    .select({ invoice: invoices, customerName: organizations.name, orderNumber: orders.number })
    .from(invoices)
    .innerJoin(organizations, eq(organizations.id, invoices.customerOrgId))
    .leftJoin(orders, eq(orders.id, invoices.orderId))
    .where(eq(invoices.id, id));
  if (!row) throw notFound("Invoice not found.");
  assertCanSee(actor, row.invoice);
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.sortOrder));
  const staff = staffCanRead(actor);
  const pays = await db
    .select({ p: payments, recordedByName: users.name })
    .from(payments)
    .leftJoin(users, eq(users.id, payments.recordedBy))
    .where(and(eq(payments.invoiceId, id), staff ? undefined : inArray(payments.status, ["success", "reversed"])))
    .orderBy(desc(payments.createdAt));
  return { ...row.invoice, customerName: row.customerName, orderNumber: row.orderNumber, lines, payments: pays };
}

/** The order's current (non-void) invoice, if any. */
export async function invoiceForOrder(db: DB, orderId: string) {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.orderId, orderId), ne(invoices.status, "void")));
  return inv ?? null;
}

/** Outstanding and overdue totals for one customer (or all customers). Staff or the customer itself. */
export async function receivables(db: DB, actor: Actor, customerOrgId?: string, now = new Date()) {
  const orgId = staffCanRead(actor) ? customerOrgId : actor.organizationId;
  if (!staffCanRead(actor)) authorize(actor, "customer.invoices.read", { organizationId: actor.organizationId });
  const [r] = await db
    .select({
      outstanding: sql<number>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor}), 0)::bigint`,
      overdue: sql<number>`coalesce(sum(case when ${invoices.dueAt} < ${now} then ${invoices.totalMinor} - ${invoices.paidMinor} else 0 end), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(invoices)
    .where(and(inArray(invoices.status, OPEN_STATUSES), orgId ? eq(invoices.customerOrgId, orgId) : undefined));
  return { outstandingMinor: Number(r?.outstanding ?? 0), overdueMinor: Number(r?.overdue ?? 0), openCount: r?.count ?? 0 };
}

// ───────────────────────────── Reminders ─────────────────────────────

/** Daily job: in-app + e-mail reminders for overdue invoices (at most 3, a week apart). */
export async function sendInvoiceReminders(db: DB, now = new Date()) {
  const due = await db
    .select({ invoice: invoices, customerName: organizations.name })
    .from(invoices)
    .innerJoin(organizations, eq(organizations.id, invoices.customerOrgId))
    .where(
      and(
        inArray(invoices.status, OPEN_STATUSES),
        lt(invoices.dueAt, now),
        lt(invoices.remindersSent, MAX_REMINDERS),
        eq(invoices.isDemo, false),
        or(isNull(invoices.lastReminderAt), lt(invoices.lastReminderAt, new Date(now.getTime() - REMINDER_GAP_DAYS * DAY))),
      ),
    );
  if (due.length === 0) return 0;
  const s = await getSettings(db);
  for (const { invoice: inv } of due) {
    await db.transaction(async (tx) => {
      const recipients = await usersWithPermission(tx, "customer.invoices.read", inv.customerOrgId);
      const balance = formatMoney(balanceOf(inv), inv.currency);
      await notifyUsers(tx, recipients, { title: `Invoice ${inv.number} is overdue`, body: `Balance due: ${balance}.`, link: `/portal/invoices/${inv.id}` });
      const emails = recipients.length ? await tx.select({ email: users.email }).from(users).where(inArray(users.id, recipients)) : [];
      for (const { email } of emails) {
        await sendMail(tx, {
          to: email,
          subject: `Reminder: invoice ${inv.number} is overdue`,
          body: `Invoice ${inv.number} from ${s.companyName} was due on ${inv.dueAt.toISOString().slice(0, 10)}.\nBalance due: ${balance}.\n\nView and pay it in your customer portal: ${process.env.APP_URL ?? ""}/portal/invoices/${inv.id}\n\nIf you have already paid, please ignore this message or reply with the payment reference.\n${s.supportEmail}`,
        });
      }
      await tx.update(invoices).set({ remindersSent: inv.remindersSent + 1, lastReminderAt: now }).where(eq(invoices.id, inv.id));
      await audit(tx, { action: "invoice.reminder_sent", targetType: "invoice", targetId: inv.id, data: { reminder: inv.remindersSent + 1, recipients: recipients.length } });
    });
  }
  announce();
  return due.length;
}
