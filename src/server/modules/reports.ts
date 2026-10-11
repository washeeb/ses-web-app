import { and, eq, gte, inArray, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DB } from "../db/client";
import {
  approvalRequests,
  inboundEvents,
  invoices,
  jobs,
  leads,
  orderLines,
  orders,
  payments,
  projectMilestones,
  projects,
  projectTasks,
  purchaseOrders,
  quotes,
  returnRequests,
  stockLevels,
  stockLocations,
  subscriptions,
  suppliers,
  tickets,
} from "../db/schema";
import { authorize, can, type Actor } from "../authz/policy";
import { LOW_STOCK_AT } from "./inventory";

const count = sql<number>`count(*)::int`;

/** Headline numbers for the operations dashboard; each figure respects the viewer's permissions. */
export async function dashboardStats(db: DB, actor: Actor) {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const out: { [K in "newLeads" | "quotesPendingApproval" | "openQuotes" | "pendingOrders" | "pendingApprovals" | "deadLetters" | "failingEvents" | "wonValue30d" | "openTickets" | "breachedTickets" | "overdueInvoicesMinor"]: number | null } = {
    newLeads: null,
    quotesPendingApproval: null,
    openQuotes: null,
    pendingOrders: null,
    pendingApprovals: null,
    deadLetters: null,
    failingEvents: null,
    wonValue30d: null,
    openTickets: null,
    breachedTickets: null,
    overdueInvoicesMinor: null,
  };
  if (can(actor, "leads.read")) out.newLeads = (await db.select({ n: count }).from(leads).where(eq(leads.status, "new")))[0]!.n;
  if (can(actor, "quotes.read")) {
    out.quotesPendingApproval = (await db.select({ n: count }).from(quotes).where(eq(quotes.status, "pending_approval")))[0]!.n;
    out.openQuotes = (await db.select({ n: count }).from(quotes).where(eq(quotes.status, "sent")))[0]!.n;
  }
  if (can(actor, "orders.read")) {
    out.pendingOrders = (await db.select({ n: count }).from(orders).where(eq(orders.status, "pending")))[0]!.n;
    out.wonValue30d = Number(
      (
        await db
          .select({ v: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::bigint` })
          .from(orders)
          .where(and(gte(orders.createdAt, since30), sql`${orders.status} in ('pending','confirmed','fulfilled')`))
      )[0]!.v,
    );
  }
  if (can(actor, "approvals.read")) out.pendingApprovals = (await db.select({ n: count }).from(approvalRequests).where(eq(approvalRequests.status, "pending")))[0]!.n;
  if (can(actor, "integrations.read")) {
    out.deadLetters =
      (await db.select({ n: count }).from(inboundEvents).where(eq(inboundEvents.status, "dead")))[0]!.n +
      (await db.select({ n: count }).from(jobs).where(eq(jobs.status, "dead")))[0]!.n;
    out.failingEvents = (await db.select({ n: count }).from(inboundEvents).where(eq(inboundEvents.status, "failed")))[0]!.n;
  }
  if (can(actor, "support.read")) {
    const open = inArray(tickets.status, ["new", "open", "pending_customer"]);
    out.openTickets = (await db.select({ n: count }).from(tickets).where(open))[0]!.n;
    out.breachedTickets = (await db.select({ n: count }).from(tickets).where(and(open, eq(tickets.resolutionBreached, true))))[0]!.n;
  }
  if (can(actor, "finance.read")) {
    out.overdueInvoicesMinor = Number(
      (
        await db
          .select({ v: sql<number>`coalesce(sum(${invoices.totalMinor} - ${invoices.paidMinor}), 0)::bigint` })
          .from(invoices)
          .where(and(inArray(invoices.status, ["issued", "part_paid"]), lt(invoices.dueAt, new Date())))
      )[0]!.v,
    );
  }
  return out;
}

// ───────────────────────────── Department reports ─────────────────────────────

export interface Bar {
  label: string;
  value: number;
}
const num = (v: unknown) => Number(v ?? 0);
const DAY = 86_400_000;

export interface DepartmentReports {
  sales?: { leadsByStatus: Bar[]; quoteOutcomes: Bar[]; conversionPct: number | null; orderValueByMonth: Bar[]; topProducts: Bar[] };
  finance?: { ageing: Bar[]; invoicedByMonth: Bar[]; collectedByMonth: Bar[]; paymentsByMethod: Bar[] };
  support?: { opened: number; resolved: number; responseMetPct: number | null; resolutionMetPct: number | null; openByPriority: Bar[]; byCategory: Bar[] };
  subscriptions?: { active: number; mrrMinor: number; renewalsDue30d: number; lapsed: number };
  projects?: { byStatus: Bar[]; awaitingSignoff: number; overdueTasks: number };
  operations?: { awaitingFulfilment: number | null; lowStock: number | null; poSpendBySupplier: Bar[] | null; returnsByKind: Bar[] | null };
}

/** Each section is present only if the viewer may read the underlying data. Figures are aggregates only. */
export async function departmentReports(db: DB, actor: Actor, days: number, now = new Date()): Promise<DepartmentReports> {
  authorize(actor, "reports.read");
  const since = new Date(now.getTime() - days * DAY);
  const yearAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const month = (col: SQL | AnyPgColumn) => sql<string>`to_char(date_trunc('month', ${col}), 'YYYY-MM')`;
  const bars = (rows: { label: string | null; value: unknown }[]) => rows.map((x) => ({ label: x.label ?? "—", value: num(x.value) }));
  const r: DepartmentReports = {};

  if (can(actor, "leads.read") || can(actor, "quotes.read") || can(actor, "orders.read")) {
    const leadsByStatus = can(actor, "leads.read") ? bars(await db.select({ label: leads.status, value: count }).from(leads).where(gte(leads.createdAt, since)).groupBy(leads.status)) : [];
    const quoteOutcomes = can(actor, "quotes.read") ? bars(await db.select({ label: quotes.status, value: count }).from(quotes).where(gte(quotes.createdAt, since)).groupBy(quotes.status)) : [];
    const won = quoteOutcomes.find((q) => q.label === "accepted")?.value ?? 0;
    const lost = quoteOutcomes.filter((q) => ["declined", "expired"].includes(q.label)).reduce((a, q) => a + q.value, 0);
    const live = sql`${orders.status} not in ('cancelled','expired')`;
    const orderValueByMonth = can(actor, "orders.read")
      ? bars(
          await db
            .select({ label: month(orders.createdAt), value: sql<number>`sum(${orders.totalMinor})::bigint` })
            .from(orders)
            .where(and(gte(orders.createdAt, yearAgo), live))
            .groupBy(month(orders.createdAt))
            .orderBy(month(orders.createdAt)),
        )
      : [];
    const topProducts = can(actor, "orders.read")
      ? bars(
          await db
            .select({ label: orderLines.description, value: sql<number>`sum(${orderLines.lineTotalMinor})::bigint` })
            .from(orderLines)
            .innerJoin(orders, eq(orders.id, orderLines.orderId))
            .where(and(gte(orders.createdAt, since), live))
            .groupBy(orderLines.description)
            .orderBy(sql`sum(${orderLines.lineTotalMinor}) desc`)
            .limit(5),
        )
      : [];
    r.sales = { leadsByStatus, quoteOutcomes, conversionPct: won + lost ? Math.round((won / (won + lost)) * 100) : null, orderValueByMonth, topProducts };
  }

  if (can(actor, "finance.read")) {
    const open = await db.select().from(invoices).where(inArray(invoices.status, ["issued", "part_paid"]));
    const buckets = [
      { label: "Not yet due", min: -Infinity, max: 0 },
      { label: "1–30 days overdue", min: 0, max: 30 },
      { label: "31–60 days overdue", min: 30, max: 60 },
      { label: "61–90 days overdue", min: 60, max: 90 },
      { label: "Over 90 days overdue", min: 90, max: Infinity },
    ];
    const ageing = buckets.map((b) => ({
      label: b.label,
      value: open
        .filter((i) => {
          const late = (now.getTime() - i.dueAt.getTime()) / DAY;
          return late > b.min && late <= b.max;
        })
        .reduce((a, i) => a + i.totalMinor - i.paidMinor, 0),
    }));
    const invoicedByMonth = bars(
      await db
        .select({ label: month(invoices.issuedAt), value: sql<number>`sum(${invoices.totalMinor})::bigint` })
        .from(invoices)
        .where(and(gte(invoices.issuedAt, yearAgo), sql`${invoices.status} <> 'void'`))
        .groupBy(month(invoices.issuedAt))
        .orderBy(month(invoices.issuedAt)),
    );
    const real = and(eq(payments.status, "success"), sql`${payments.mode} <> 'test'`);
    const collectedByMonth = bars(
      await db
        .select({ label: month(payments.paidAt), value: sql<number>`sum(${payments.amountMinor})::bigint` })
        .from(payments)
        .where(and(real, gte(payments.paidAt, yearAgo)))
        .groupBy(month(payments.paidAt))
        .orderBy(month(payments.paidAt)),
    );
    const method = sql<string>`coalesce(${payments.method}, ${payments.provider})`;
    const paymentsByMethod = bars(
      await db
        .select({ label: method, value: sql<number>`sum(${payments.amountMinor})::bigint` })
        .from(payments)
        .where(and(real, gte(payments.paidAt, since)))
        .groupBy(method),
    );
    r.finance = { ageing, invoicedByMonth, collectedByMonth, paymentsByMethod };
  }

  if (can(actor, "support.read")) {
    const inRange = await db.select().from(tickets).where(gte(tickets.createdAt, since));
    const responded = inRange.filter((t) => t.firstRespondedAt || t.responseBreached);
    const finished = inRange.filter((t) => t.resolvedAt || t.closedAt);
    const open = await db.select({ label: tickets.priority, value: count }).from(tickets).where(inArray(tickets.status, ["new", "open", "pending_customer"])).groupBy(tickets.priority);
    const byCategory = new Map<string, number>();
    for (const t of inRange) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + 1);
    r.support = {
      opened: inRange.length,
      resolved: finished.length,
      responseMetPct: responded.length ? Math.round((responded.filter((t) => !t.responseBreached).length / responded.length) * 100) : null,
      resolutionMetPct: finished.length ? Math.round((finished.filter((t) => !t.resolutionBreached).length / finished.length) * 100) : null,
      openByPriority: ["urgent", "high", "normal", "low"].map((p) => ({ label: p, value: num(open.find((o) => o.label === p)?.value) })),
      byCategory: [...byCategory].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value),
    };
  }

  if (can(actor, "subscriptions.manage") || can(actor, "finance.read") || can(actor, "orders.read")) {
    const active = await db.select().from(subscriptions).where(eq(subscriptions.status, "active"));
    const mrr = active.reduce((a, s) => a + (s.billingPeriod === "year" ? Math.round((s.unitPriceMinor * s.quantity) / 12) : s.unitPriceMinor * s.quantity), 0);
    const [lapsed] = await db.select({ n: count }).from(subscriptions).where(and(eq(subscriptions.status, "lapsed"), gte(subscriptions.endedAt, since)));
    r.subscriptions = {
      active: active.length,
      mrrMinor: mrr,
      renewalsDue30d: active.filter((s) => s.autoRenew && s.currentPeriodEnd.getTime() - now.getTime() <= 30 * DAY).length,
      lapsed: num(lapsed?.n),
    };
  }

  if (can(actor, "projects.read")) {
    const byStatus = bars(await db.select({ label: projects.status, value: count }).from(projects).groupBy(projects.status));
    const [awaiting] = await db.select({ n: count }).from(projectMilestones).where(eq(projectMilestones.status, "awaiting_signoff"));
    const [overdue] = await db.select({ n: count }).from(projectTasks).where(and(lt(projectTasks.dueDate, now), sql`${projectTasks.status} <> 'done'`));
    r.projects = { byStatus, awaitingSignoff: num(awaiting?.n), overdueTasks: num(overdue?.n) };
  }

  if (can(actor, "orders.read") || can(actor, "inventory.read") || can(actor, "procurement.read")) {
    const awaitingFulfilment = can(actor, "orders.read") ? num((await db.select({ n: count }).from(orders).where(eq(orders.status, "confirmed")))[0]?.n) : null;
    const lowStock = can(actor, "inventory.read")
      ? num(
          (
            await db
              .select({ n: sql<number>`count(distinct ${stockLevels.variantId})::int` })
              .from(stockLevels)
              .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
              .where(and(isNull(stockLocations.connectionId), lte(sql`${stockLevels.onHand} - ${stockLevels.reserved}`, LOW_STOCK_AT)))
          )[0]?.n,
        )
      : null;
    const poSpendBySupplier = can(actor, "procurement.read")
      ? bars(
          await db
            .select({ label: suppliers.name, value: sql<number>`sum(${purchaseOrders.totalMinor})::bigint` })
            .from(purchaseOrders)
            .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
            .where(and(gte(purchaseOrders.createdAt, since), inArray(purchaseOrders.status, ["approved", "sent", "partially_received", "received"])))
            .groupBy(suppliers.name)
            .orderBy(sql`sum(${purchaseOrders.totalMinor}) desc`)
            .limit(5),
        )
      : null;
    const returnsByKind = can(actor, "orders.read")
      ? bars(await db.select({ label: returnRequests.kind, value: count }).from(returnRequests).where(gte(returnRequests.createdAt, since)).groupBy(returnRequests.kind))
      : null;
    r.operations = { awaitingFulfilment, lowStock, poSpendBySupplier, returnsByKind };
  }
  return r;
}
