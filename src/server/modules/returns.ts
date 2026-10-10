import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import {
  approvalRequests,
  orderLines,
  orders,
  organizations,
  productVariants,
  returnLines,
  returnRequests,
  stockLevels,
  stockLocations,
  users,
  warranties,
} from "../db/schema";
import { authorize, can, type Actor } from "../authz/policy";
import { conflict, forbidden, invalid, notFound } from "../lib/errors";
import { formatMoney } from "../lib/money";
import { audit } from "./audit";
import { publish } from "./events";
import { recordMovement } from "./inventory";
import { announce, customerRecipients, notifyApprovers, notifyPermission, notifyUsers } from "./notifications";
import { getSettings, nextNumber, operatorOrgId } from "./settings";

const DAY = 86_400_000;
/** Statuses that still "hold" the returned quantity (so it cannot be claimed twice). */
const ACTIVE = ["requested", "approved", "received", "refund_pending", "completed"];

// ───────────────────────────── Warranties ─────────────────────────────

/** Called when an order is fulfilled: one warranty per line whose product carries one. */
export async function createWarrantiesForOrder(tx: DB, orderId: string, fulfilledAt: Date) {
  const rows = await tx
    .select({ line: orderLines, months: productVariants.warrantyMonths, customerOrgId: orders.customerOrgId })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderLines.variantId))
    .where(and(eq(orderLines.orderId, orderId), gt(productVariants.warrantyMonths, 0)));
  for (const r of rows) {
    const endsAt = new Date(fulfilledAt);
    endsAt.setUTCMonth(endsAt.getUTCMonth() + r.months);
    await tx.insert(warranties).values({
      orderId,
      orderLineId: r.line.id,
      customerOrgId: r.customerOrgId,
      variantId: r.line.variantId!,
      quantity: r.line.quantity,
      startsAt: fulfilledAt,
      endsAt,
    });
  }
  return rows.length;
}

export async function listWarranties(db: DB, actor: Actor) {
  const base = db
    .select({ w: warranties, description: orderLines.description, orderNumber: orders.number, customerName: organizations.name })
    .from(warranties)
    .innerJoin(orderLines, eq(orderLines.id, warranties.orderLineId))
    .innerJoin(orders, eq(orders.id, warranties.orderId))
    .innerJoin(organizations, eq(organizations.id, warranties.customerOrgId))
    .orderBy(desc(warranties.endsAt));
  if (can(actor, "orders.read")) return base.limit(500);
  authorize(actor, "customer.orders.read", { organizationId: actor.organizationId });
  return base.where(eq(warranties.customerOrgId, actor.organizationId));
}

// ───────────────────────────── Returns (RMA) ─────────────────────────────

/** Order lines of a fulfilled order with the quantity still returnable and any active warranty cover. */
export async function returnableLines(db: DB, orderId: string, now = new Date()) {
  const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, orderId));
  if (lines.length === 0) return [];
  const claimed = await db
    .select({ orderLineId: returnLines.orderLineId, qty: sql<number>`sum(${returnLines.quantity})::int` })
    .from(returnLines)
    .innerJoin(returnRequests, eq(returnRequests.id, returnLines.returnId))
    .where(and(inArray(returnLines.orderLineId, lines.map((l) => l.id)), inArray(returnRequests.status, ACTIVE)))
    .groupBy(returnLines.orderLineId);
  const cover = await db
    .select()
    .from(warranties)
    .where(and(inArray(warranties.orderLineId, lines.map((l) => l.id)), gt(warranties.endsAt, now)));
  return lines.map((l) => ({
    line: l,
    returnable: l.quantity - (claimed.find((c) => c.orderLineId === l.id)?.qty ?? 0),
    warrantyEndsAt: cover.find((w) => w.orderLineId === l.id)?.endsAt ?? null,
  }));
}

export const returnInput = z.object({
  orderId: z.string().uuid(),
  kind: z.enum(["return", "warranty"]),
  resolution: z.enum(["refund", "replacement", "repair"]),
  reason: z.string().trim().min(10, "Describe the problem (at least 10 characters).").max(2000),
  lines: z.array(z.object({ orderLineId: z.string().uuid(), quantity: z.number().int().min(0) })).min(1),
});

export async function requestReturn(db: DB, actor: Actor, input: z.input<typeof returnInput>, now = new Date()) {
  const data = returnInput.parse(input);
  const s = await getSettings(db);
  const [order] = await db.select().from(orders).where(eq(orders.id, data.orderId));
  if (!order) throw notFound("Order not found.");
  const staff = can(actor, "returns.manage");
  if (!staff && !can(actor, "customer.returns.request", { organizationId: order.customerOrgId })) {
    if (actor.organizationId !== order.customerOrgId) throw notFound("Order not found.");
    throw forbidden("Your account cannot request returns. Ask your organisation's administrator.");
  }
  if (order.status !== "fulfilled" || !order.fulfilledAt) throw conflict("Returns can only be requested for delivered (fulfilled) orders.");
  if (data.kind === "return" && data.resolution === "repair") throw invalid("Repairs are handled as warranty claims.");
  if (data.kind === "return" && now.getTime() - order.fulfilledAt.getTime() > s.returnWindowDays * DAY) {
    throw conflict(`The ${s.returnWindowDays}-day return window has passed. Faulty items can still be claimed under warranty.`);
  }
  const wanted = data.lines.filter((l) => l.quantity > 0);
  if (wanted.length === 0) throw invalid("Choose at least one item and quantity.");
  const available = await returnableLines(db, order.id, now);
  for (const w of wanted) {
    const a = available.find((x) => x.line.id === w.orderLineId);
    if (!a) throw invalid("An item does not belong to this order.");
    if (w.quantity > a.returnable) throw conflict(`Only ${a.returnable} of "${a.line.description}" can still be returned.`);
    if (data.kind === "warranty" && !a.warrantyEndsAt) throw conflict(`"${a.line.description}" is not under warranty.`);
  }
  const rma = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(returnRequests)
      .values({
        number: await nextNumber(tx, "RMA"),
        orderId: order.id,
        customerOrgId: order.customerOrgId,
        kind: data.kind,
        resolution: data.resolution,
        reason: data.reason,
        requestedBy: actor.userId,
      })
      .returning();
    await tx.insert(returnLines).values(
      wanted.map((w) => ({ returnId: r!.id, orderLineId: w.orderLineId, variantId: available.find((a) => a.line.id === w.orderLineId)!.line.variantId, quantity: w.quantity })),
    );
    await audit(tx, { actor, action: "return.requested", targetType: "return", targetId: r!.id, data: { number: r!.number, kind: data.kind, resolution: data.resolution } });
    await notifyPermission(tx, "returns.manage", { title: `${data.kind === "warranty" ? "Warranty claim" : "Return"} ${r!.number} requested`, body: `Order ${order.number}: ${data.reason.slice(0, 140)}`, link: `/ops/returns/${r!.id}` }, { exclude: actor.userId });
    return r!;
  });
  publish({ topic: "returns", orgIds: [order.customerOrgId] });
  announce();
  return rma;
}

function assertCanSee(actor: Actor, r: typeof returnRequests.$inferSelect) {
  if (can(actor, "returns.manage") || can(actor, "orders.read")) return;
  if (can(actor, "customer.orders.read", { organizationId: r.customerOrgId })) return;
  throw notFound("Return not found.");
}

export async function listReturns(db: DB, actor: Actor) {
  const base = db
    .select({ r: returnRequests, orderNumber: orders.number, customerName: organizations.name })
    .from(returnRequests)
    .innerJoin(orders, eq(orders.id, returnRequests.orderId))
    .innerJoin(organizations, eq(organizations.id, returnRequests.customerOrgId))
    .orderBy(desc(returnRequests.createdAt));
  if (can(actor, "returns.manage") || can(actor, "orders.read")) return base.limit(500);
  authorize(actor, "customer.orders.read", { organizationId: actor.organizationId });
  return base.where(eq(returnRequests.customerOrgId, actor.organizationId));
}

export async function getReturn(db: DB, actor: Actor, id: string) {
  const [row] = await db
    .select({ r: returnRequests, order: orders, customerName: organizations.name, requesterName: users.name })
    .from(returnRequests)
    .innerJoin(orders, eq(orders.id, returnRequests.orderId))
    .innerJoin(organizations, eq(organizations.id, returnRequests.customerOrgId))
    .innerJoin(users, eq(users.id, returnRequests.requestedBy))
    .where(eq(returnRequests.id, id));
  if (!row) throw notFound("Return not found.");
  assertCanSee(actor, row.r);
  const lines = await db
    .select({ rl: returnLines, line: orderLines, tracksStock: productVariants.tracksStock })
    .from(returnLines)
    .innerJoin(orderLines, eq(orderLines.id, returnLines.orderLineId))
    .leftJoin(productVariants, eq(productVariants.id, returnLines.variantId))
    .where(eq(returnLines.returnId, id));
  return { ...row, lines, refundEstimateMinor: refundAmount(row.order, lines) };
}

/** Proportional share of what the customer paid for the returned items (after discount, including taxes). */
function refundAmount(order: typeof orders.$inferSelect, lines: { rl: typeof returnLines.$inferSelect; line: typeof orderLines.$inferSelect }[]) {
  const gross = lines.reduce((a, { rl, line }) => a + rl.quantity * line.unitPriceMinor, 0);
  if (order.subtotalMinor <= 0) return 0;
  return Math.round((gross * order.totalMinor) / order.subtotalMinor);
}

async function lockReturn(tx: DB, id: string) {
  const [r] = await tx.select().from(returnRequests).where(eq(returnRequests.id, id)).for("update");
  if (!r) throw notFound("Return not found.");
  return r;
}

/** Status updates go to the customer organisation's users who can see orders. */
async function tellRequester(tx: DB, r: typeof returnRequests.$inferSelect, title: string, body?: string) {
  const ids = await customerRecipients(tx, "customer.orders.read", r.customerOrgId);
  await notifyUsers(tx, ids, { title, body, link: `/portal/returns/${r.id}` });
}

export async function decideReturn(db: DB, actor: Actor, id: string, approve: boolean, note: string) {
  authorize(actor, "returns.manage");
  const r = await db.transaction(async (tx) => {
    const r = await lockReturn(tx, id);
    if (r.status !== "requested") throw conflict("This request has already been decided.");
    if (!approve && note.trim().length < 3) throw invalid("Give the customer a reason for the rejection.");
    await tx.update(returnRequests).set({ status: approve ? "approved" : "rejected", decidedBy: actor.userId, decisionNote: note.trim() || null }).where(eq(returnRequests.id, id));
    await audit(tx, { actor, action: approve ? "return.approved" : "return.rejected", targetType: "return", targetId: id, data: { note } });
    await tellRequester(tx, r, `${r.number} ${approve ? "approved" : "rejected"}`, approve ? "Please send or bring the item(s) back; we will confirm when received." : note);
    return r;
  });
  publish({ topic: "returns", orgIds: [r.customerOrgId] });
  announce();
}

/**
 * Records the goods as received back. Optionally restocks resellable items into an SES location (stock ledger
 * reason "return"). A refund resolution then needs approval from someone with refunds.approve.
 */
export async function receiveReturn(db: DB, actor: Actor, id: string, input: { restock: boolean; locationId?: string | null }) {
  authorize(actor, "returns.manage");
  const r = await db.transaction(async (tx) => {
    const r = await lockReturn(tx, id);
    if (r.status !== "approved") throw conflict("Only approved returns can be received.");
    const lines = await tx
      .select({ rl: returnLines, line: orderLines, tracksStock: productVariants.tracksStock })
      .from(returnLines)
      .innerJoin(orderLines, eq(orderLines.id, returnLines.orderLineId))
      .leftJoin(productVariants, eq(productVariants.id, returnLines.variantId))
      .where(eq(returnLines.returnId, id));
    let restocked = false;
    if (input.restock) {
      const [loc] = input.locationId ? await tx.select().from(stockLocations).where(eq(stockLocations.id, input.locationId)) : [];
      if (!loc || loc.connectionId) throw invalid("Choose an SES location to restock into.");
      for (const { rl, tracksStock } of lines) {
        if (!rl.variantId || !tracksStock) continue;
        const [lvl] = await tx.select().from(stockLevels).where(and(eq(stockLevels.variantId, rl.variantId), eq(stockLevels.locationId, loc.id))).for("update");
        if (lvl) await tx.update(stockLevels).set({ onHand: sql`${stockLevels.onHand} + ${rl.quantity}` }).where(eq(stockLevels.id, lvl.id));
        else await tx.insert(stockLevels).values({ variantId: rl.variantId, locationId: loc.id, onHand: rl.quantity });
        await recordMovement(tx, { variantId: rl.variantId, locationId: loc.id, quantity: rl.quantity, reason: "return", refType: "return", refId: id, actorUserId: actor.userId });
        restocked = true;
      }
    }
    const [order] = await tx.select().from(orders).where(eq(orders.id, r.orderId));
    const refundMinor = r.resolution === "refund" ? refundAmount(order!, lines) : null;
    const status = r.resolution === "refund" ? "refund_pending" : "received";
    await tx.update(returnRequests).set({ status, receivedBy: actor.userId, receivedAt: new Date(), restocked, refundMinor }).where(eq(returnRequests.id, id));
    if (r.resolution === "refund") {
      const summary = `Refund for ${r.number} (order ${order!.number}): ${formatMoney(refundMinor!, order!.currency)}`;
      await tx.insert(approvalRequests).values({
        organizationId: await operatorOrgId(tx),
        type: "refund",
        subjectType: "return",
        subjectId: id,
        summary,
        payload: { number: r.number, orderNumber: order!.number, refundMinor, currency: order!.currency },
        requestedBy: actor.userId,
      });
      await notifyApprovers(tx, "refund", id, summary, actor.userId);
    }
    await audit(tx, { actor, action: "return.received", targetType: "return", targetId: id, data: { restocked, refundMinor } });
    await tellRequester(tx, r, `${r.number}: items received`, r.resolution === "refund" ? "Your refund is being approved." : "We will complete the replacement or repair and let you know.");
    return r;
  });
  publish({ topic: "returns", orgIds: [r.customerOrgId] });
  publish({ topic: "stock" });
  publish({ topic: "approvals" });
  announce();
}

/** Called by the approvals module inside its transaction. */
export async function applyRefundDecision(tx: DB, returnId: string, approved: boolean, approverId: string) {
  const r = await lockReturn(tx, returnId);
  if (r.status !== "refund_pending") throw conflict("This return is no longer awaiting a refund decision.");
  if (r.receivedBy === approverId) throw forbidden("You cannot approve a refund for a return you processed.");
  await tx
    .update(returnRequests)
    .set(approved ? { status: "completed", completedAt: new Date() } : { status: "received", decisionNote: "Refund not approved; resolve another way." })
    .where(eq(returnRequests.id, returnId));
  if (approved) await tellRequester(tx, r, `${r.number}: refund approved`, "The refund will be paid to you by our finance team.");
}

/** Replacement/repair done (refunds complete through the approval instead). */
export async function completeReturn(db: DB, actor: Actor, id: string, note: string) {
  authorize(actor, "returns.manage");
  const r = await db.transaction(async (tx) => {
    const r = await lockReturn(tx, id);
    if (r.status !== "received") throw conflict("Only received returns can be completed here.");
    if (note.trim().length < 3) throw invalid("Describe what was done (e.g. replacement dispatched).");
    await tx.update(returnRequests).set({ status: "completed", completedAt: new Date(), decisionNote: note.trim() }).where(eq(returnRequests.id, id));
    await audit(tx, { actor, action: "return.completed", targetType: "return", targetId: id, data: { note } });
    await tellRequester(tx, r, `${r.number} completed`, note);
    return r;
  });
  publish({ topic: "returns", orgIds: [r.customerOrgId] });
  announce();
}

/** The requester (or staff) may withdraw a request that has not been decided yet. */
export async function cancelReturn(db: DB, actor: Actor, id: string) {
  const r = await db.transaction(async (tx) => {
    const r = await lockReturn(tx, id);
    const own = r.requestedBy === actor.userId || can(actor, "customer.returns.request", { organizationId: r.customerOrgId });
    if (!own && !can(actor, "returns.manage")) throw notFound("Return not found.");
    if (r.status !== "requested") throw conflict("Only undecided requests can be withdrawn.");
    await tx.update(returnRequests).set({ status: "cancelled" }).where(eq(returnRequests.id, id));
    await audit(tx, { actor, action: "return.cancelled", targetType: "return", targetId: id });
    return r;
  });
  publish({ topic: "returns", orgIds: [r.customerOrgId] });
}



/** True while a delivered order is inside the return window. */
export function withinReturnWindow(fulfilledAt: Date, windowDays: number, now = new Date()) {
  return now.getTime() - fulfilledAt.getTime() <= windowDays * DAY;
}
