import { and, eq, gte, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { approvalRequests, inboundEvents, jobs, leads, orders, quotes } from "../db/schema";
import { can, type Actor } from "../authz/policy";

const count = sql<number>`count(*)::int`;

/** Headline numbers for the operations dashboard; each figure respects the viewer's permissions. */
export async function dashboardStats(db: DB, actor: Actor) {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const out: { [K in "newLeads" | "quotesPendingApproval" | "openQuotes" | "pendingOrders" | "pendingApprovals" | "deadLetters" | "failingEvents" | "wonValue30d"]: number | null } = {
    newLeads: null,
    quotesPendingApproval: null,
    openQuotes: null,
    pendingOrders: null,
    pendingApprovals: null,
    deadLetters: null,
    failingEvents: null,
    wonValue30d: null,
  };
  if (can(actor, "leads.read")) out.newLeads = (await db.select({ n: count }).from(leads).where(eq(leads.status, "new")))[0]!.n;
  if (can(actor, "quotes.read")) {
    out.quotesPendingApproval = (await db.select({ n: count }).from(quotes).where(eq(quotes.status, "pending_approval")))[0]!.n;
    out.openQuotes = (await db.select({ n: count }).from(quotes).where(eq(quotes.status, "sent")))[0]!.n;
  }
  if (can(actor, "orders.read")) {
    out.pendingOrders = (await db.select({ n: count }).from(orders).where(eq(orders.status, "pending")))[0]!.n;
    out.wonValue30d = (
      await db
        .select({ v: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::bigint` })
        .from(orders)
        .where(and(gte(orders.createdAt, since30), sql`${orders.status} in ('pending','confirmed','fulfilled')`))
    )[0]!.v;
    out.wonValue30d = Number(out.wonValue30d);
  }
  if (can(actor, "approvals.read")) out.pendingApprovals = (await db.select({ n: count }).from(approvalRequests).where(eq(approvalRequests.status, "pending")))[0]!.n;
  if (can(actor, "integrations.read")) {
    out.deadLetters =
      (await db.select({ n: count }).from(inboundEvents).where(eq(inboundEvents.status, "dead")))[0]!.n +
      (await db.select({ n: count }).from(jobs).where(eq(jobs.status, "dead")))[0]!.n;
    out.failingEvents = (await db.select({ n: count }).from(inboundEvents).where(eq(inboundEvents.status, "failed")))[0]!.n;
  }
  return out;
}
