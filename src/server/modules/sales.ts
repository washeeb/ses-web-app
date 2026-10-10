import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import {
  approvalRequests,
  departments,
  integrationConnections,
  leads,
  orderLines,
  orders,
  organizations,
  productMappings,
  products,
  productVariants,
  quoteLines,
  quotes,
  stockReservations,
} from "../db/schema";
import { authorize, can, departmentFilter, type Actor } from "../authz/policy";
import { AppError, conflict, forbidden, invalid, notFound } from "../lib/errors";
import { computeTotals } from "../lib/money";
import { enforce } from "../auth/rate-limit";
import { audit } from "./audit";
import { publish } from "./events";
import { enqueue } from "./jobs";
import { clearReservationExpiry, consumeReservations, releaseReservations, reserveForOrder } from "./inventory";
import { activeTaxes, getSettings, nextNumber, operatorOrgId } from "./settings";
import { announce, customerRecipients, notifyApprovers, notifyPermission, notifyUsers } from "./notifications";
import { createWarrantiesForOrder } from "./returns";
import { issueInvoiceForOrder, settleInvoicesForClosedOrder } from "./invoices";
import { createSubscriptionsForOrder } from "./subscriptions";
import { createAssetsForOrder } from "./assets";

// ───────────────────────────── Enquiries & leads ─────────────────────────────

export const enquiryInput = z.object({
  contactName: z.string().trim().min(2, "Enter your name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid e-mail address.").max(200),
  phone: z.string().trim().max(40).optional().default(""),
  companyName: z.string().trim().max(160).optional().default(""),
  serviceInterest: z.string().trim().max(120).optional().default(""),
  message: z.string().trim().min(10, "Tell us a little more (at least 10 characters).").max(4000),
  /** Honeypot: real users never fill this in. */
  website: z.string().max(0).optional().default(""),
});

export async function createEnquiry(db: DB, input: z.input<typeof enquiryInput>, ip: string | null) {
  const data = enquiryInput.parse(input);
  await enforce(db, `enquiry:ip:${ip ?? "unknown"}`, 5, 60 * 60);
  const orgId = await operatorOrgId(db);
  const [salesDept] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.organizationId, orgId), eq(departments.key, "sales")));
  const lead = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(leads)
      .values({
        number: await nextNumber(tx, "L"),
        source: "website",
        contactName: data.contactName,
        email: data.email,
        phone: data.phone || null,
        companyName: data.companyName || null,
        serviceInterest: data.serviceInterest || null,
        message: data.message,
        departmentId: salesDept?.id ?? null,
      })
      .returning();
    await audit(tx, { action: "lead.created", targetType: "lead", targetId: row!.id, ip, data: { source: "website" } });
    return row!;
  });
  publish({ topic: "leads" });
  return { number: lead.number };
}

function deptCondition(actor: Actor, perm: Parameters<typeof departmentFilter>[1], column: typeof leads.departmentId | typeof quotes.departmentId) {
  const depts = departmentFilter(actor, perm);
  if (depts === null) return undefined;
  return depts.length ? or(isNull(column), inArray(column, depts)) : isNull(column);
}

export async function listLeads(db: DB, actor: Actor) {
  authorize(actor, "leads.read");
  return db.select().from(leads).where(deptCondition(actor, "leads.read", leads.departmentId)).orderBy(desc(leads.createdAt)).limit(500);
}

export const LEAD_STATUSES = ["new", "contacted", "qualified", "won", "lost"] as const;

export async function updateLeadStatus(db: DB, actor: Actor, id: string, status: string) {
  const parsed = z.enum(LEAD_STATUSES).parse(status);
  const [lead] = await db.select().from(leads).where(eq(leads.id, id));
  if (!lead) throw notFound("Lead not found.");
  authorize(actor, "leads.write", { departmentId: lead.departmentId });
  await db.update(leads).set({ status: parsed, ownerUserId: lead.ownerUserId ?? actor.userId }).where(eq(leads.id, id));
  await audit(db, { actor, action: "lead.status_changed", targetType: "lead", targetId: id, data: { from: lead.status, to: parsed } });
  publish({ topic: "leads" });
}

/** Lead-to-sale: turn a qualified lead into a customer organisation. */
export async function convertLeadToCustomer(db: DB, actor: Actor, leadId: string) {
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));
  if (!lead) throw notFound("Lead not found.");
  authorize(actor, "leads.write", { departmentId: lead.departmentId });
  if (lead.customerOrgId) return lead.customerOrgId;
  const name = lead.companyName || lead.contactName;
  return db.transaction(async (tx) => {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "customer";
    const [org] = await tx.insert(organizations).values({ type: "customer", name, slug: `${base}-${lead.number.toLowerCase()}` }).returning();
    await tx.update(leads).set({ customerOrgId: org!.id, status: lead.status === "new" ? "qualified" : lead.status }).where(eq(leads.id, leadId));
    await audit(tx, { actor, action: "lead.converted", targetType: "lead", targetId: leadId, data: { customerOrgId: org!.id } });
    return org!.id;
  });
}

export async function listCustomers(db: DB, actor: Actor) {
  if (!can(actor, "quotes.read") && !can(actor, "leads.read")) throw forbidden();
  return db.select().from(organizations).where(eq(organizations.type, "customer")).orderBy(asc(organizations.name));
}

// ───────────────────────────── Quotations ─────────────────────────────

/** Statuses a customer can see. Drafts and internal approval states stay internal. */
const CUSTOMER_VISIBLE = ["sent", "accepted", "declined", "expired"];

export const quoteInput = z.object({
  customerOrgId: z.string().uuid("Choose a customer."),
  leadId: z.string().uuid().nullable().optional(),
  discountBp: z.number().int().min(0).max(5000),
  notes: z.string().trim().max(2000).optional().default(""),
  lines: z
    .array(
      z.union([
        z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(100_000) }),
        z.object({
          description: z.string().trim().min(3).max(300),
          quantity: z.number().int().min(1).max(100_000),
          unitPriceMinor: z.number().int().min(0),
          taxable: z.boolean().default(true),
        }),
      ]),
    )
    .min(1, "Add at least one line."),
});

export async function createQuote(db: DB, actor: Actor, input: z.input<typeof quoteInput>) {
  authorize(actor, "quotes.write");
  const data = quoteInput.parse(input);
  const s = await getSettings(db);
  const [customer] = await db.select().from(organizations).where(and(eq(organizations.id, data.customerOrgId), eq(organizations.type, "customer")));
  if (!customer) throw invalid("Unknown customer.");

  const variantIds = data.lines.flatMap((l) => ("variantId" in l ? [l.variantId] : []));
  const variants = variantIds.length
    ? await db
        .select({ v: productVariants, productName: products.name, productStatus: products.status })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(inArray(productVariants.id, variantIds))
    : [];
  const resolved = data.lines.map((l) => {
    if ("variantId" in l) {
      const found = variants.find((x) => x.v.id === l.variantId);
      if (!found || !found.v.active || found.productStatus !== "active") throw invalid("A selected product is not available for sale.");
      if (found.v.currency !== s.defaultCurrency) throw invalid(`${found.v.sku} is priced in ${found.v.currency}; mixed currencies are not supported yet.`);
      return { variantId: found.v.id, description: `${found.productName} — ${found.v.name} (${found.v.sku})`, quantity: l.quantity, unitPriceMinor: found.v.priceMinor, taxable: found.v.taxable };
    }
    return { variantId: null, description: l.description, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, taxable: l.taxable };
  });
  const taxes = await activeTaxes(db);
  const totals = computeTotals({ lines: resolved, discountBp: data.discountBp, taxes });

  let departmentId: string | null = null;
  if (data.leadId) {
    const [lead] = await db.select().from(leads).where(eq(leads.id, data.leadId));
    if (!lead) throw invalid("Unknown lead.");
    departmentId = lead.departmentId;
  }
  authorize(actor, "quotes.write", { departmentId });

  const quote = await db.transaction(async (tx) => {
    const [q] = await tx
      .insert(quotes)
      .values({
        number: await nextNumber(tx, "Q"),
        customerOrgId: customer.id,
        leadId: data.leadId ?? null,
        departmentId,
        status: "draft",
        currency: s.defaultCurrency,
        subtotalMinor: totals.subtotalMinor,
        discountBp: data.discountBp,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        taxBreakdown: totals.breakdown,
        validUntil: new Date(Date.now() + s.quoteValidityDays * 86_400_000),
        notes: data.notes || null,
        createdBy: actor.userId,
      })
      .returning();
    await tx.insert(quoteLines).values(resolved.map((l, i) => ({ ...l, quoteId: q!.id, lineTotalMinor: totals.lineTotals[i]!, sortOrder: i })));
    await audit(tx, { actor, action: "quote.created", targetType: "quote", targetId: q!.id, data: { number: q!.number, totalMinor: q!.totalMinor } });
    return q!;
  });
  publish({ topic: "quotes" });
  return quote;
}

function assertCanSeeQuote(actor: Actor, q: typeof quotes.$inferSelect) {
  if (can(actor, "quotes.read", { departmentId: q.departmentId })) return;
  if (can(actor, "customer.quotes.read", { organizationId: q.customerOrgId }) && CUSTOMER_VISIBLE.includes(q.status)) return;
  // Do not reveal whether the quotation exists.
  throw notFound("Quotation not found.");
}

export async function getQuote(db: DB, actor: Actor, id: string) {
  const [row] = await db
    .select({ quote: quotes, customerName: organizations.name })
    .from(quotes)
    .innerJoin(organizations, eq(organizations.id, quotes.customerOrgId))
    .where(eq(quotes.id, id));
  if (!row) throw notFound("Quotation not found.");
  assertCanSeeQuote(actor, row.quote);
  const lines = await db.select().from(quoteLines).where(eq(quoteLines.quoteId, id)).orderBy(asc(quoteLines.sortOrder));
  const approvals = can(actor, "quotes.read")
    ? await db.select().from(approvalRequests).where(and(eq(approvalRequests.subjectType, "quote"), eq(approvalRequests.subjectId, id))).orderBy(desc(approvalRequests.createdAt))
    : [];
  const [order] = await db.select({ id: orders.id, number: orders.number, status: orders.status }).from(orders).where(eq(orders.quoteId, id));
  return { ...row.quote, customerName: row.customerName, lines, approvals, order: order ?? null };
}

export async function listQuotes(db: DB, actor: Actor) {
  const base = db
    .select({ quote: quotes, customerName: organizations.name })
    .from(quotes)
    .innerJoin(organizations, eq(organizations.id, quotes.customerOrgId));
  if (can(actor, "quotes.read")) {
    return base.where(deptCondition(actor, "quotes.read", quotes.departmentId)).orderBy(desc(quotes.createdAt)).limit(500);
  }
  authorize(actor, "customer.quotes.read", { organizationId: actor.organizationId });
  return base
    .where(and(eq(quotes.customerOrgId, actor.organizationId), inArray(quotes.status, CUSTOMER_VISIBLE)))
    .orderBy(desc(quotes.createdAt));
}

async function lockQuote(tx: DB, id: string) {
  const [q] = await tx.select().from(quotes).where(eq(quotes.id, id)).for("update");
  if (!q) throw notFound("Quotation not found.");
  return q;
}

/** Draft → approved, or → pending_approval when over value or discount limits. */
export async function submitQuote(db: DB, actor: Actor, id: string) {
  const s = await getSettings(db);
  const result = await db.transaction(async (tx) => {
    const q = await lockQuote(tx, id);
    authorize(actor, "quotes.write", { departmentId: q.departmentId });
    if (q.status !== "draft") throw conflict(`Only draft quotations can be submitted (this one is ${q.status}).`);
    const reasons: string[] = [];
    if (q.totalMinor >= s.quoteApprovalThresholdMinor) reasons.push("total at or above approval threshold");
    if (q.discountBp > s.maxDiscountBpWithoutApproval) reasons.push("discount above limit");
    if (reasons.length) {
      await tx.update(quotes).set({ status: "pending_approval" }).where(eq(quotes.id, id));
      await tx.insert(approvalRequests).values({
        organizationId: await operatorOrgId(tx),
        type: "quote.approval",
        subjectType: "quote",
        subjectId: id,
        summary: `Quotation ${q.number}: ${reasons.join("; ")}`,
        payload: { number: q.number, totalMinor: q.totalMinor, discountBp: q.discountBp, currency: q.currency, reasons },
        requestedBy: actor.userId,
      });
      await audit(tx, { actor, action: "quote.submitted_for_approval", targetType: "quote", targetId: id, data: { reasons } });
      await notifyApprovers(tx, "quote.approval", id, `Quotation ${q.number}: ${reasons.join("; ")}`, actor.userId);
      return "pending_approval" as const;
    }
    await tx.update(quotes).set({ status: "approved", approvedAt: new Date() }).where(eq(quotes.id, id));
    await audit(tx, { actor, action: "quote.auto_approved", targetType: "quote", targetId: id });
    return "approved" as const;
  });
  publish({ topic: result === "approved" ? "quotes" : "approvals" });
  return result;
}

export async function sendQuote(db: DB, actor: Actor, id: string) {
  const q = await db.transaction(async (tx) => {
    const q = await lockQuote(tx, id);
    authorize(actor, "quotes.write", { departmentId: q.departmentId });
    if (q.status !== "approved") throw conflict("Only approved quotations can be sent.");
    await tx.update(quotes).set({ status: "sent", sentAt: new Date() }).where(eq(quotes.id, id));
    await audit(tx, { actor, action: "quote.sent", targetType: "quote", targetId: id });
    await notifyUsers(tx, await customerRecipients(tx, "customer.quotes.read", q.customerOrgId), {
      title: `New quotation ${q.number}`,
      body: "Review and accept it in your portal.",
      link: `/portal/quotes/${id}`,
    });
    return q;
  });
  publish({ topic: "quotes", orgIds: [q.customerOrgId] });
  announce();
}

export async function declineQuote(db: DB, actor: Actor, id: string) {
  const q = await db.transaction(async (tx) => {
    const q = await lockQuote(tx, id);
    authorize(actor, "customer.quotes.accept", { organizationId: q.customerOrgId });
    if (q.status !== "sent") throw conflict("This quotation can no longer be declined.");
    await tx.update(quotes).set({ status: "declined" }).where(eq(quotes.id, id));
    await audit(tx, { actor, action: "quote.declined", targetType: "quote", targetId: id });
    return q;
  });
  publish({ topic: "quotes", orgIds: [q.customerOrgId] });
}

/** Customer acceptance creates the order and reserves stock atomically. */
export async function acceptQuote(db: DB, actor: Actor, id: string, now = new Date()) {
  const s = await getSettings(db);
  const order = await db.transaction(async (tx) => {
    const q = await lockQuote(tx, id);
    if (!can(actor, "customer.quotes.accept", { organizationId: q.customerOrgId })) {
      // Hide existence from other organisations; plain 403 for same-org users lacking the right.
      if (actor.organizationId !== q.customerOrgId) throw notFound("Quotation not found.");
      throw forbidden("Only a customer administrator can accept quotations.");
    }
    if (q.status !== "sent") throw conflict("This quotation is not open for acceptance.");
    if (q.validUntil && q.validUntil < now) {
      await tx.update(quotes).set({ status: "expired" }).where(eq(quotes.id, id));
      throw new AppError("conflict", "This quotation has expired. Please ask us for an updated quotation.");
    }
    const lines = await tx.select().from(quoteLines).where(eq(quoteLines.quoteId, id)).orderBy(asc(quoteLines.sortOrder));
    const [o] = await tx
      .insert(orders)
      .values({
        number: await nextNumber(tx, "O"),
        customerOrgId: q.customerOrgId,
        quoteId: q.id,
        status: "pending",
        currency: q.currency,
        subtotalMinor: q.subtotalMinor,
        discountMinor: q.discountMinor,
        taxMinor: q.taxMinor,
        totalMinor: q.totalMinor,
        taxBreakdown: q.taxBreakdown,
        createdBy: actor.userId,
        isDemo: q.isDemo,
      })
      .returning();
    const variantIds = lines.flatMap((l) => (l.variantId ? [l.variantId] : []));
    const variants = variantIds.length ? await tx.select().from(productVariants).where(inArray(productVariants.id, variantIds)) : [];
    const stockLines = lines.flatMap((l) => {
      const v = variants.find((x) => x.id === l.variantId);
      return v?.tracksStock ? [{ variantId: v.id, quantity: l.quantity, sku: v.sku }] : [];
    });
    const allocations = await reserveForOrder(tx, o!.id, stockLines, new Date(now.getTime() + s.reservationHoldHours * 3_600_000), now);
    await tx.insert(orderLines).values(
      lines.map((l) => ({
        orderId: o!.id,
        variantId: l.variantId,
        description: l.description,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        taxable: l.taxable,
        lineTotalMinor: l.lineTotalMinor,
        fulfilmentConnectionId: allocations.find((a) => a.variantId === l.variantId && a.connectionId)?.connectionId ?? null,
      })),
    );
    await tx.update(quotes).set({ status: "accepted", acceptedAt: now, acceptedBy: actor.userId }).where(eq(quotes.id, id));
    await issueInvoiceForOrder(tx, o!.id, { actor: null, now });
    await audit(tx, { actor, action: "quote.accepted", targetType: "quote", targetId: id, data: { orderId: o!.id, orderNumber: o!.number } });
    await notifyPermission(tx, "orders.write", { title: `New order ${o!.number}`, body: `Quotation ${q.number} was accepted. Confirm the order.`, link: `/ops/orders/${o!.id}` });
    return o!;
  });
  publish({ topic: "orders", orgIds: [order.customerOrgId] });
  publish({ topic: "invoices", orgIds: [order.customerOrgId] });
  publish({ topic: "stock" });
  announce();
  return order;
}

/** Called by the approvals module inside its transaction. */
export async function applyQuoteDecision(tx: DB, quoteId: string, approved: boolean, approverId: string) {
  const q = await lockQuote(tx, quoteId);
  if (q.status !== "pending_approval") throw conflict("Quotation is no longer awaiting approval.");
  if (q.createdBy === approverId) throw forbidden("You cannot approve a quotation you created.");
  await tx
    .update(quotes)
    .set(approved ? { status: "approved", approvedBy: approverId, approvedAt: new Date() } : { status: "rejected" })
    .where(eq(quotes.id, quoteId));
}

// ───────────────────────────── Orders ─────────────────────────────

export async function listOrders(db: DB, actor: Actor) {
  const base = db
    .select({ order: orders, customerName: organizations.name })
    .from(orders)
    .innerJoin(organizations, eq(organizations.id, orders.customerOrgId));
  if (can(actor, "orders.read")) return base.orderBy(desc(orders.createdAt)).limit(500);
  authorize(actor, "customer.orders.read", { organizationId: actor.organizationId });
  return base.where(eq(orders.customerOrgId, actor.organizationId)).orderBy(desc(orders.createdAt));
}

export async function getOrder(db: DB, actor: Actor, id: string) {
  const [row] = await db
    .select({ order: orders, customerName: organizations.name })
    .from(orders)
    .innerJoin(organizations, eq(organizations.id, orders.customerOrgId))
    .where(eq(orders.id, id));
  if (!row) throw notFound("Order not found.");
  if (!can(actor, "orders.read") && !can(actor, "customer.orders.read", { organizationId: row.order.customerOrgId })) {
    throw notFound("Order not found.");
  }
  const lines = await db
    .select({ line: orderLines, connectionName: integrationConnections.name })
    .from(orderLines)
    .leftJoin(integrationConnections, eq(integrationConnections.id, orderLines.fulfilmentConnectionId))
    .where(eq(orderLines.orderId, id));
  const reservations = can(actor, "orders.read") ? await db.select().from(stockReservations).where(eq(stockReservations.orderId, id)) : [];
  return { ...row.order, customerName: row.customerName, lines, reservations };
}

async function lockOrder(tx: DB, id: string) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
  if (!o) throw notFound("Order not found.");
  return o;
}

async function requestPartnerFulfilment(tx: DB, orderId: string, type: "order.fulfilment_requested" | "order.cancelled") {
  const lines = await tx.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
  const byConnection = new Map<string, typeof lines>();
  for (const l of lines) {
    if (!l.fulfilmentConnectionId) continue;
    byConnection.set(l.fulfilmentConnectionId, [...(byConnection.get(l.fulfilmentConnectionId) ?? []), l]);
  }
  for (const [connectionId, ls] of byConnection) {
    const partnerLines = [];
    for (const l of ls) {
      const [map] = await tx
        .select({ partnerSku: productMappings.partnerSku })
        .from(productMappings)
        .where(and(eq(productMappings.connectionId, connectionId), eq(productMappings.variantId, l.variantId!)));
      partnerLines.push({ line_id: l.id, sku: map?.partnerSku ?? null, quantity: l.quantity });
    }
    await enqueue(tx, {
      type: "integration.outbound.deliver",
      dedupeKey: `${type}:${orderId}:${connectionId}`,
      payload: { connectionId, type, data: { order_number: order!.number, lines: partnerLines } },
    });
    if (type === "order.fulfilment_requested") {
      await tx.update(orderLines).set({ fulfilmentStatus: "requested" }).where(and(eq(orderLines.orderId, orderId), eq(orderLines.fulfilmentConnectionId, connectionId)));
    }
  }
}

export async function confirmOrder(db: DB, actor: Actor, id: string) {
  authorize(actor, "orders.write");
  const o = await db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== "pending") throw conflict(`Only pending orders can be confirmed (this one is ${o.status}).`);
    await tx.update(orders).set({ status: "confirmed" }).where(eq(orders.id, id));
    await clearReservationExpiry(tx, id);
    await requestPartnerFulfilment(tx, id, "order.fulfilment_requested");
    await audit(tx, { actor, action: "order.confirmed", targetType: "order", targetId: id });
    await notifyUsers(tx, await customerRecipients(tx, "customer.orders.read", o.customerOrgId), { title: `Order ${o.number} confirmed`, link: `/portal/orders/${id}` });
    return o;
  });
  publish({ topic: "orders", orgIds: [o.customerOrgId] });
}

export async function fulfilOrder(db: DB, actor: Actor, id: string) {
  authorize(actor, "orders.write");
  const o = await db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== "confirmed") throw conflict("Only confirmed orders can be marked fulfilled.");
    const open = await tx
      .select()
      .from(orderLines)
      .where(and(eq(orderLines.orderId, id), inArray(orderLines.fulfilmentStatus, ["requested", "accepted", "rejected"])));
    if (open.length) throw conflict("Partner-fulfilled lines must be shipped or delivered first.");
    await consumeReservations(tx, id);
    const fulfilledAt = new Date();
    await tx.update(orders).set({ status: "fulfilled", fulfilledAt }).where(eq(orders.id, id));
    const warrantyCount = await createWarrantiesForOrder(tx, id, fulfilledAt);
    const subscriptionCount = await createSubscriptionsForOrder(tx, id, fulfilledAt);
    const assetCount = await createAssetsForOrder(tx, id, fulfilledAt);
    await audit(tx, { actor, action: "order.fulfilled", targetType: "order", targetId: id, data: { warranties: warrantyCount, subscriptions: subscriptionCount, assets: assetCount } });
    await notifyUsers(tx, await customerRecipients(tx, "customer.orders.read", o.customerOrgId), { title: `Order ${o.number} delivered`, body: warrantyCount ? "Warranty cover has started for eligible items." : undefined, link: `/portal/orders/${id}` });
    return o;
  });
  publish({ topic: "orders", orgIds: [o.customerOrgId] });
  publish({ topic: "subscriptions", orgIds: [o.customerOrgId] });
  publish({ topic: "assets", orgIds: [o.customerOrgId] });
  publish({ topic: "stock" });
}

export async function cancelOrder(db: DB, actor: Actor, id: string, reason: string) {
  authorize(actor, "orders.write");
  if (reason.trim().length < 3) throw invalid("Give a reason for cancelling.");
  const o = await db.transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (!["pending", "confirmed"].includes(o.status)) throw conflict("This order can no longer be cancelled.");
    await releaseReservations(tx, id);
    if (o.status === "confirmed") await requestPartnerFulfilment(tx, id, "order.cancelled");
    await settleInvoicesForClosedOrder(tx, id, `order cancelled: ${reason.trim()}`);
    await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, id));
    await audit(tx, { actor, action: "order.cancelled", targetType: "order", targetId: id, data: { reason } });
    await notifyUsers(tx, await customerRecipients(tx, "customer.orders.read", o.customerOrgId), { title: `Order ${o.number} cancelled`, body: reason, link: `/portal/orders/${id}` });
    return o;
  });
  publish({ topic: "orders", orgIds: [o.customerOrgId] });
  publish({ topic: "stock" });
}
