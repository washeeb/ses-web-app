import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { invoices, orderLines, orders, organizations, productVariants, serviceContracts, subscriptions, type SlaTargets } from "../db/schema";
import { authorize, can, type Actor } from "../authz/policy";
import { conflict, forbidden, invalid, notFound } from "../lib/errors";
import { formatMoney } from "../lib/money";
import { audit } from "./audit";
import { publish } from "./events";
import { issueStandaloneInvoice } from "./invoices";
import { announce, notifyPermission, notifyUsers, usersWithPermission } from "./notifications";
import { getSettings, nextNumber } from "./settings";
import { addPeriod, DEFAULT_SLA, PRIORITIES, type Coverage } from "./service-time";

const DAY = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

type Subscription = typeof subscriptions.$inferSelect;

function staffCanRead(actor: Actor) {
  return can(actor, "subscriptions.manage") || can(actor, "orders.read") || can(actor, "finance.read") || can(actor, "support.read");
}

async function customerSubscriptionUsers(db: DB, orgId: string) {
  return usersWithPermission(db, "customer.subscriptions.read", orgId);
}

// ───────────────────────────── Creating ─────────────────────────────

/** Called when an order is fulfilled: one subscription per line whose option bills monthly or yearly. */
export async function createSubscriptionsForOrder(tx: DB, orderId: string, startsAt: Date) {
  const rows = await tx
    .select({ line: orderLines, v: productVariants, order: orders })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderLines.variantId))
    .where(and(eq(orderLines.orderId, orderId), isNotNull(productVariants.billingPeriod)));
  for (const { line, v, order } of rows) {
    if (!["month", "year"].includes(v.billingPeriod!)) continue;
    const [sub] = await tx
      .insert(subscriptions)
      .values({
        number: await nextNumber(tx, "SUB", startsAt),
        customerOrgId: order.customerOrgId,
        variantId: v.id,
        description: line.description,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        currency: order.currency,
        taxable: line.taxable,
        billingPeriod: v.billingPeriod!,
        currentPeriodStart: startsAt,
        currentPeriodEnd: addPeriod(startsAt, v.billingPeriod!),
        sourceOrderId: orderId,
        sourceOrderLineId: line.id,
        isDemo: order.isDemo,
      })
      .returning();
    await audit(tx, { action: "subscription.created", targetType: "subscription", targetId: sub!.id, data: { number: sub!.number, orderId } });
  }
  return rows.length;
}

export const subscriptionInput = z.object({
  customerOrgId: z.string().uuid("Choose a customer."),
  variantId: z.string().uuid("Choose a subscription product."),
  quantity: z.number().int().min(1).max(100_000),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the start date."),
  autoRenew: z.boolean().default(true),
});

/** Records a subscription sold outside the store (e.g. migrating an existing customer). */
export async function createSubscription(db: DB, actor: Actor, input: z.input<typeof subscriptionInput>) {
  authorize(actor, "subscriptions.manage");
  const data = subscriptionInput.parse(input);
  const [customer] = await db.select().from(organizations).where(and(eq(organizations.id, data.customerOrgId), eq(organizations.type, "customer")));
  if (!customer) throw invalid("Unknown customer.");
  const [v] = await db.select().from(productVariants).where(eq(productVariants.id, data.variantId));
  if (!v || !v.billingPeriod || !["month", "year"].includes(v.billingPeriod)) throw invalid("Choose a product option that bills monthly or yearly.");
  const start = new Date(`${data.startsOn}T00:00:00Z`);
  const sub = await db.transaction(async (tx) => {
    const [sub] = await tx
      .insert(subscriptions)
      .values({
        number: await nextNumber(tx, "SUB"),
        customerOrgId: customer.id,
        variantId: v.id,
        description: `${v.name} (${v.sku})`,
        quantity: data.quantity,
        unitPriceMinor: v.priceMinor,
        currency: v.currency,
        taxable: v.taxable,
        billingPeriod: v.billingPeriod!,
        autoRenew: data.autoRenew,
        currentPeriodStart: start,
        currentPeriodEnd: addPeriod(start, v.billingPeriod!),
        createdBy: actor.userId,
      })
      .returning();
    await audit(tx, { actor, action: "subscription.created", targetType: "subscription", targetId: sub!.id, data: { number: sub!.number, manual: true } });
    return sub!;
  });
  publish({ topic: "subscriptions", orgIds: [sub.customerOrgId] });
  return sub;
}

// ───────────────────────────── Reading ─────────────────────────────

export async function listSubscriptions(db: DB, actor: Actor, opts: { customerOrgId?: string } = {}) {
  const base = db
    .select({ s: subscriptions, customerName: organizations.name })
    .from(subscriptions)
    .innerJoin(organizations, eq(organizations.id, subscriptions.customerOrgId))
    .orderBy(asc(subscriptions.currentPeriodEnd))
    .limit(500);
  if (staffCanRead(actor)) return opts.customerOrgId ? base.where(eq(subscriptions.customerOrgId, opts.customerOrgId)) : base;
  authorize(actor, "customer.subscriptions.read", { organizationId: actor.organizationId });
  return base.where(eq(subscriptions.customerOrgId, actor.organizationId));
}

export async function getSubscription(db: DB, actor: Actor, id: string) {
  const [row] = await db
    .select({ s: subscriptions, customerName: organizations.name })
    .from(subscriptions)
    .innerJoin(organizations, eq(organizations.id, subscriptions.customerOrgId))
    .where(eq(subscriptions.id, id));
  if (!row || (!staffCanRead(actor) && !can(actor, "customer.subscriptions.read", { organizationId: row.s.customerOrgId }))) throw notFound("Subscription not found.");
  const renewals = await db.select().from(invoices).where(eq(invoices.subscriptionId, id)).orderBy(desc(invoices.issuedAt));
  return { ...row.s, customerName: row.customerName, renewals };
}

// ───────────────────────────── Changing ─────────────────────────────

async function lockSub(tx: DB, id: string) {
  const [s] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id)).for("update");
  if (!s) throw notFound("Subscription not found.");
  return s;
}

/** Voids an unpaid renewal invoice (or tells finance when money is already on it). */
async function dropRenewalInvoice(tx: DB, sub: Subscription, reason: string) {
  if (!sub.renewalInvoiceId) return;
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, sub.renewalInvoiceId)).for("update");
  if (inv && ["issued", "part_paid"].includes(inv.status)) {
    if (inv.paidMinor === 0) {
      await tx.update(invoices).set({ status: "void", voidedAt: new Date(), voidReason: reason }).where(eq(invoices.id, inv.id));
      await audit(tx, { action: "invoice.voided", targetType: "invoice", targetId: inv.id, data: { number: inv.number, reason, automatic: true } });
    } else {
      await notifyPermission(tx, "finance.write", { title: `Refund due on ${inv.number}`, body: `Subscription ${sub.number}: ${reason}. ${formatMoney(inv.paidMinor, inv.currency)} was already paid.`, link: `/ops/invoices/${inv.id}` });
    }
  }
  await tx.update(subscriptions).set({ renewalInvoiceId: null }).where(eq(subscriptions.id, sub.id));
}

/** Customer administrators and staff can stop (or restart) automatic renewal. */
export async function setAutoRenew(db: DB, actor: Actor, id: string, autoRenew: boolean) {
  const sub = await db.transaction(async (tx) => {
    const sub = await lockSub(tx, id);
    const staff = can(actor, "subscriptions.manage");
    if (!staff && !can(actor, "customer.subscriptions.manage", { organizationId: sub.customerOrgId })) {
      if (actor.organizationId !== sub.customerOrgId && !staffCanRead(actor)) throw notFound("Subscription not found.");
      throw forbidden("Only your organisation's administrator can change renewal.");
    }
    if (sub.status !== "active") throw conflict(`This subscription is ${sub.status}.`);
    if (sub.autoRenew === autoRenew) return sub;
    await tx.update(subscriptions).set({ autoRenew }).where(eq(subscriptions.id, id));
    if (!autoRenew) await dropRenewalInvoice(tx, sub, "automatic renewal turned off");
    await audit(tx, { actor, action: autoRenew ? "subscription.auto_renew_on" : "subscription.auto_renew_off", targetType: "subscription", targetId: id });
    if (!staff) await notifyPermission(tx, "subscriptions.manage", { title: `${sub.number}: renewal turned ${autoRenew ? "on" : "off"} by the customer`, link: `/ops/subscriptions/${id}` });
    return sub;
  });
  publish({ topic: "subscriptions", orgIds: [sub.customerOrgId] });
  publish({ topic: "invoices", orgIds: [sub.customerOrgId] });
  announce();
}

/** Ends a subscription immediately (staff only). */
export async function cancelSubscription(db: DB, actor: Actor, id: string, reason: string) {
  authorize(actor, "subscriptions.manage");
  if (reason.trim().length < 3) throw invalid("Give a reason.");
  const sub = await db.transaction(async (tx) => {
    const sub = await lockSub(tx, id);
    if (sub.status !== "active") throw conflict(`This subscription is already ${sub.status}.`);
    await dropRenewalInvoice(tx, sub, "subscription cancelled");
    await tx.update(subscriptions).set({ status: "cancelled", endedAt: new Date(), endReason: reason.trim(), autoRenew: false }).where(eq(subscriptions.id, id));
    await audit(tx, { actor, action: "subscription.cancelled", targetType: "subscription", targetId: id, data: { reason: reason.trim() } });
    await notifyUsers(tx, await customerSubscriptionUsers(tx, sub.customerOrgId), { title: `Subscription ${sub.number} cancelled`, body: reason.trim(), link: `/portal/subscriptions` });
    return sub;
  });
  publish({ topic: "subscriptions", orgIds: [sub.customerOrgId] });
  announce();
}

// ───────────────────────────── Renewal job ─────────────────────────────

/**
 * Daily: issue renewal invoices `renewalNoticeDays` before the period ends; end subscriptions that will not
 * renew; lapse those whose renewal is still unpaid `renewalGraceDays` after the period ended.
 */
export async function runRenewals(db: DB, now = new Date()) {
  const s = await getSettings(db);
  const counts = { invoiced: 0, ended: 0, lapsed: 0 };

  const due = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.status, "active"), eq(subscriptions.autoRenew, true), isNull(subscriptions.renewalInvoiceId), lte(subscriptions.currentPeriodEnd, new Date(now.getTime() + s.renewalNoticeDays * DAY))));
  for (const sub of due) {
    await db.transaction(async (tx) => {
      const locked = await lockSub(tx, sub.id);
      if (locked.renewalInvoiceId || locked.status !== "active") return;
      // Renew at today's catalogue price when the option is still sold; otherwise at the current price.
      const [v] = locked.variantId ? await tx.select().from(productVariants).where(eq(productVariants.id, locked.variantId)) : [];
      const unitPriceMinor = v?.active && v.currency === locked.currency ? v.priceMinor : locked.unitPriceMinor;
      const nextEnd = addPeriod(locked.currentPeriodEnd, locked.billingPeriod);
      const inv = await issueStandaloneInvoice(tx, {
        customerOrgId: locked.customerOrgId,
        currency: locked.currency,
        subscriptionId: locked.id,
        lines: [{ description: `${locked.description} — renewal ${isoDate(locked.currentPeriodEnd)} to ${isoDate(nextEnd)}`, quantity: locked.quantity, unitPriceMinor, taxable: locked.taxable }],
        dueAt: new Date(Math.max(locked.currentPeriodEnd.getTime(), now.getTime() + 7 * DAY)),
        notes: `Renewal of subscription ${locked.number}. Pay by the due date to keep the service running without interruption.`,
        actor: null,
        isDemo: locked.isDemo,
        now,
      });
      await tx.update(subscriptions).set({ renewalInvoiceId: inv.id, unitPriceMinor }).where(eq(subscriptions.id, locked.id));
      await audit(tx, { action: "subscription.renewal_invoiced", targetType: "subscription", targetId: locked.id, data: { invoice: inv.number } });
      counts.invoiced++;
    });
  }

  const ending = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.status, "active"), eq(subscriptions.autoRenew, false), lte(subscriptions.currentPeriodEnd, now)));
  for (const sub of ending) {
    await db.transaction(async (tx) => {
      await tx.update(subscriptions).set({ status: "ended", endedAt: now, endReason: "not renewed" }).where(and(eq(subscriptions.id, sub.id), eq(subscriptions.status, "active")));
      await audit(tx, { action: "subscription.ended", targetType: "subscription", targetId: sub.id });
      await notifyUsers(tx, await customerSubscriptionUsers(tx, sub.customerOrgId), { title: `Subscription ${sub.number} has ended`, link: "/portal/subscriptions" });
    });
    counts.ended++;
  }

  const lapsing = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.status, "active"), isNotNull(subscriptions.renewalInvoiceId), lte(subscriptions.currentPeriodEnd, new Date(now.getTime() - s.renewalGraceDays * DAY))));
  for (const sub of lapsing) {
    await db.transaction(async (tx) => {
      const locked = await lockSub(tx, sub.id);
      if (locked.status !== "active" || !locked.renewalInvoiceId) return;
      await dropRenewalInvoice(tx, locked, "renewal not paid in time");
      await tx.update(subscriptions).set({ status: "lapsed", endedAt: now, endReason: "renewal not paid" }).where(eq(subscriptions.id, locked.id));
      await audit(tx, { action: "subscription.lapsed", targetType: "subscription", targetId: locked.id });
      await notifyUsers(tx, await customerSubscriptionUsers(tx, locked.customerOrgId), { title: `Subscription ${locked.number} has lapsed`, body: "The renewal invoice was not paid. Contact us to restart the service.", link: "/portal/subscriptions" });
      await notifyPermission(tx, "subscriptions.manage", { title: `Subscription ${locked.number} lapsed`, body: "Renewal not paid within the grace period.", link: `/ops/subscriptions/${locked.id}` });
    });
    counts.lapsed++;
  }
  if (counts.invoiced || counts.ended || counts.lapsed) {
    publish({ topic: "subscriptions" });
    publish({ topic: "invoices" });
    announce();
  }
  return counts;
}

// ───────────────────────────── Service contracts ─────────────────────────────

const hours = z.number().min(0.25).max(24 * 90);
export const contractInput = z.object({
  customerOrgId: z.string().uuid("Choose a customer."),
  name: z.string().trim().min(3).max(120),
  coverage: z.enum(["business_hours", "24x7"]),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Targets in hours, per priority. */
  targets: z.record(z.enum(PRIORITIES), z.object({ responseHours: hours, resolutionHours: hours })),
  notes: z.string().trim().max(2000).optional().default(""),
});

export async function createContract(db: DB, actor: Actor, input: z.input<typeof contractInput>) {
  authorize(actor, "subscriptions.manage");
  const data = contractInput.parse(input);
  const startsAt = new Date(`${data.startsOn}T00:00:00Z`);
  const endsAt = new Date(`${data.endsOn}T23:59:59Z`);
  if (endsAt <= startsAt) throw invalid("The end date must be after the start date.");
  const slaTargets = {} as SlaTargets;
  for (const p of PRIORITIES) {
    const t = data.targets[p];
    if (!t) throw invalid(`Set targets for ${p} priority.`);
    if (t.resolutionHours < t.responseHours) throw invalid(`For ${p} priority, resolution cannot be faster than the first response.`);
    slaTargets[p] = { responseMinutes: Math.round(t.responseHours * 60), resolutionMinutes: Math.round(t.resolutionHours * 60) };
  }
  const [customer] = await db.select().from(organizations).where(and(eq(organizations.id, data.customerOrgId), eq(organizations.type, "customer")));
  if (!customer) throw invalid("Unknown customer.");
  const c = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(serviceContracts)
      .values({ number: await nextNumber(tx, "SC"), customerOrgId: customer.id, name: data.name, coverage: data.coverage, slaTargets, startsAt, endsAt, notes: data.notes || null, createdBy: actor.userId })
      .returning();
    await audit(tx, { actor, action: "contract.created", targetType: "contract", targetId: c!.id, data: { number: c!.number, coverage: data.coverage } });
    return c!;
  });
  publish({ topic: "subscriptions", orgIds: [c.customerOrgId] });
  return c;
}

export async function cancelContract(db: DB, actor: Actor, id: string, reason: string) {
  authorize(actor, "subscriptions.manage");
  if (reason.trim().length < 3) throw invalid("Give a reason.");
  const [c] = await db.select().from(serviceContracts).where(eq(serviceContracts.id, id));
  if (!c) throw notFound("Contract not found.");
  if (c.status === "cancelled") throw conflict("Already cancelled.");
  await db.update(serviceContracts).set({ status: "cancelled", notes: [c.notes, `Cancelled: ${reason.trim()}`].filter(Boolean).join("\n") }).where(eq(serviceContracts.id, id));
  await audit(db, { actor, action: "contract.cancelled", targetType: "contract", targetId: id, data: { reason: reason.trim() } });
  publish({ topic: "subscriptions", orgIds: [c.customerOrgId] });
}

export const contractState = (c: Pick<typeof serviceContracts.$inferSelect, "status" | "startsAt" | "endsAt">, now = new Date()) =>
  c.status === "cancelled" ? "cancelled" : c.endsAt < now ? "expired" : c.startsAt > now ? "scheduled" : "active";

/** The contract that governs a customer's support right now (latest-starting active one), if any. */
export async function activeContractFor(db: DB, customerOrgId: string, now = new Date()) {
  const [c] = await db
    .select()
    .from(serviceContracts)
    .where(and(eq(serviceContracts.customerOrgId, customerOrgId), eq(serviceContracts.status, "active"), lte(serviceContracts.startsAt, now), gt(serviceContracts.endsAt, now)))
    .orderBy(desc(serviceContracts.startsAt))
    .limit(1);
  return c ?? null;
}

export async function slaFor(db: DB, customerOrgId: string, now = new Date()) {
  const c = await activeContractFor(db, customerOrgId, now);
  return c ? { contractId: c.id, coverage: c.coverage as Coverage, targets: c.slaTargets } : { contractId: null, ...DEFAULT_SLA };
}

export async function listContracts(db: DB, actor: Actor, opts: { customerOrgId?: string } = {}) {
  const base = db
    .select({ c: serviceContracts, customerName: organizations.name })
    .from(serviceContracts)
    .innerJoin(organizations, eq(organizations.id, serviceContracts.customerOrgId))
    .orderBy(desc(serviceContracts.endsAt))
    .limit(500);
  if (staffCanRead(actor)) return opts.customerOrgId ? base.where(eq(serviceContracts.customerOrgId, opts.customerOrgId)) : base;
  authorize(actor, "customer.subscriptions.read", { organizationId: actor.organizationId });
  return base.where(eq(serviceContracts.customerOrgId, actor.organizationId));
}

export async function listSubscriptionCustomers(db: DB) {
  return db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.type, "customer")).orderBy(asc(organizations.name));
}

export async function listRecurringVariants(db: DB) {
  return db
    .select({ id: productVariants.id, sku: productVariants.sku, name: productVariants.name, billingPeriod: productVariants.billingPeriod, priceMinor: productVariants.priceMinor })
    .from(productVariants)
    .where(and(eq(productVariants.active, true), inArray(productVariants.billingPeriod, ["month", "year"])))
    .orderBy(asc(productVariants.sku));
}
