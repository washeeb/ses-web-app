import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { DB } from "../db/client";
import { invoices, leads, orders, organizations, projects, quotes, returnRequests, subscriptions, tickets, users } from "../db/schema";
import { can, departmentFilter, type Actor } from "../authz/policy";
import { forbidden, notFound } from "../lib/errors";
import { OPEN_STATUSES, receivables } from "./invoices";

/** Customer history ("customer 360"): each section only appears for staff allowed to read it. */
function access(actor: Actor) {
  const a = {
    quotes: can(actor, "quotes.read"),
    orders: can(actor, "orders.read"),
    invoices: can(actor, "finance.read") || can(actor, "orders.read"),
    leads: can(actor, "leads.read"),
    tickets: can(actor, "support.read"),
    subscriptions: can(actor, "subscriptions.manage") || can(actor, "orders.read") || can(actor, "finance.read") || can(actor, "support.read"),
    projects: can(actor, "projects.read"),
  };
  if (!Object.values(a).some(Boolean)) throw forbidden();
  return a;
}

export async function listCustomersWithStats(db: DB, actor: Actor) {
  const a = access(actor);
  const orgs = await db.select().from(organizations).where(eq(organizations.type, "customer")).orderBy(asc(organizations.name));
  const ids = orgs.map((o) => o.id);
  if (ids.length === 0) return [];
  const orderStats = a.orders
    ? await db
        .select({ orgId: orders.customerOrgId, n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${orders.createdAt})` })
        .from(orders)
        .where(inArray(orders.customerOrgId, ids))
        .groupBy(orders.customerOrgId)
    : [];
  const owed = a.invoices
    ? await db
        .select({ orgId: invoices.customerOrgId, outstanding: sql<number>`sum(${invoices.totalMinor} - ${invoices.paidMinor})::bigint` })
        .from(invoices)
        .where(and(inArray(invoices.customerOrgId, ids), inArray(invoices.status, OPEN_STATUSES)))
        .groupBy(invoices.customerOrgId)
    : [];
  return orgs.map((o) => {
    const os = orderStats.find((s) => s.orgId === o.id);
    const ow = owed.find((s) => s.orgId === o.id);
    return {
      org: o,
      orders: a.orders ? (os?.n ?? 0) : null,
      lastOrderAt: os?.last ? new Date(os.last) : null,
      outstandingMinor: a.invoices ? Number(ow?.outstanding ?? 0) : null,
    };
  });
}

/** Department-scoped staff only see that department's (or untagged) quotations and leads. */
function inDepartments(actor: Actor, perm: "quotes.read" | "leads.read", column: typeof quotes.departmentId | typeof leads.departmentId): SQL | undefined {
  const depts = departmentFilter(actor, perm);
  if (depts === null) return undefined;
  return depts.length ? or(isNull(column), inArray(column, depts)) : isNull(column);
}

export async function customerHistory(db: DB, actor: Actor, orgId: string) {
  const a = access(actor);
  const [org] = await db.select().from(organizations).where(and(eq(organizations.id, orgId), eq(organizations.type, "customer")));
  if (!org) throw notFound("Customer not found.");
  const [contacts, qs, os, invs, rets, ls, owed] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email, status: users.status, lastLoginAt: users.lastLoginAt }).from(users).where(eq(users.organizationId, orgId)).orderBy(asc(users.name)),
    a.quotes ? db.select().from(quotes).where(and(eq(quotes.customerOrgId, orgId), inDepartments(actor, "quotes.read", quotes.departmentId))).orderBy(desc(quotes.createdAt)).limit(50) : Promise.resolve(null),
    a.orders ? db.select().from(orders).where(eq(orders.customerOrgId, orgId)).orderBy(desc(orders.createdAt)).limit(50) : Promise.resolve(null),
    a.invoices ? db.select().from(invoices).where(eq(invoices.customerOrgId, orgId)).orderBy(desc(invoices.issuedAt)).limit(50) : Promise.resolve(null),
    a.orders ? db.select().from(returnRequests).where(eq(returnRequests.customerOrgId, orgId)).orderBy(desc(returnRequests.createdAt)).limit(50) : Promise.resolve(null),
    a.leads ? db.select().from(leads).where(and(eq(leads.customerOrgId, orgId), inDepartments(actor, "leads.read", leads.departmentId))).orderBy(desc(leads.createdAt)).limit(20) : Promise.resolve(null),
    a.invoices ? receivables(db, actor, orgId) : Promise.resolve(null),
  ]);
  const [lifetime] = a.orders
    ? await db
        .select({ total: sql<number>`coalesce(sum(${orders.totalMinor}), 0)::bigint` })
        .from(orders)
        .where(and(eq(orders.customerOrgId, orgId), notInArray(orders.status, ["cancelled", "expired"])))
    : [];
  const lifetimeMinor = a.orders ? Number(lifetime?.total ?? 0) : null;
  const [tks, subs, projs] = await Promise.all([
    a.tickets ? db.select().from(tickets).where(eq(tickets.customerOrgId, orgId)).orderBy(desc(tickets.createdAt)).limit(30) : Promise.resolve(null),
    a.subscriptions ? db.select().from(subscriptions).where(eq(subscriptions.customerOrgId, orgId)).orderBy(desc(subscriptions.currentPeriodEnd)).limit(50) : Promise.resolve(null),
    a.projects ? db.select().from(projects).where(eq(projects.customerOrgId, orgId)).orderBy(desc(projects.createdAt)).limit(30) : Promise.resolve(null),
  ]);
  return { org, contacts, quotes: qs, orders: os, invoices: invs, returns: rets, leads: ls, receivables: owed, lifetimeMinor, tickets: tks, subscriptions: subs, projects: projs };
}
