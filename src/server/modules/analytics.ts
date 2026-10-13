import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, ne, sql, type SQL } from "drizzle-orm";
import type { DB } from "../db/client";
import {
  brands,
  categories,
  goodsReceipts,
  invoices,
  leads,
  orderLines,
  orders,
  organizations,
  payments,
  productMappings,
  products,
  productVariants,
  purchaseOrders,
  quotes,
  stockLocations,
  stockMovements,
  suppliers,
  users,
} from "../db/schema";
import { authorize, can, type Actor } from "../authz/policy";
import { loadActor } from "../auth/service";
import { formatMoney } from "../lib/money";
import { reorderList, stockOverview } from "./inventory";
import { sendMail } from "./mail";
import { usersWithPermission } from "./notifications";
import { onOrderByVariant } from "./procurement";
import { getSettings } from "./settings";

/**
 * Reporting. Figures follow simple, explainable rules:
 * - Sales = invoices issued in the period (void excluded), net of discount and before taxes.
 * - Cost of sales = average cost on each fulfilment from SES stock; for lines a partner fulfils, the partner's
 *   current cost price (an estimate: partner costs change over time).
 * - Gross margin = net sales of stock items − their cost of sales.
 * Dates are UTC, which is Accra time.
 */

const DAY = 86_400_000;

export type Range = { from: Date; to: Date; prevFrom: Date; prevTo: Date; label: string; days: number };

export const PRESETS: Record<string, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  mtd: "This month",
  lm: "Last month",
  qtd: "This quarter",
  ytd: "This year",
  "12m": "Last 12 months",
};

const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Period from ?range= (preset) or, with no preset, ?from=&to= (YYYY-MM-DD, inclusive); plus the previous period of equal length. */
export function parseRange(sp: { range?: string; from?: string; to?: string }, now = new Date()): Range {
  const today = startOfDay(now);
  const tomorrow = new Date(today.getTime() + DAY);
  let from: Date;
  let to = tomorrow;
  let label: string;
  const d = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null);
  const cf = d(sp.from);
  const ct = d(sp.to);
  if (!(sp.range && PRESETS[sp.range]) && cf && ct && cf <= ct) {
    from = cf;
    to = new Date(ct.getTime() + DAY);
    label = `${sp.from} to ${sp.to}`;
  } else {
    const key = sp.range && PRESETS[sp.range] ? sp.range : "30d";
    label = PRESETS[key]!;
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    switch (key) {
      case "7d": from = new Date(tomorrow.getTime() - 7 * DAY); break;
      case "90d": from = new Date(tomorrow.getTime() - 90 * DAY); break;
      case "mtd": from = new Date(Date.UTC(y, m, 1)); break;
      case "lm": from = new Date(Date.UTC(y, m - 1, 1)); to = new Date(Date.UTC(y, m, 1)); break;
      case "qtd": from = new Date(Date.UTC(y, m - (m % 3), 1)); break;
      case "ytd": from = new Date(Date.UTC(y, 0, 1)); break;
      case "12m": from = new Date(Date.UTC(y - 1, m, today.getUTCDate() + 1)); break;
      default: from = new Date(tomorrow.getTime() - 30 * DAY);
    }
  }
  const span = to.getTime() - from.getTime();
  return { from, to, prevFrom: new Date(from.getTime() - span), prevTo: from, label, days: Math.round(span / DAY) };
}

export function bucketFor(r: Range): "day" | "week" | "month" {
  return r.days <= 62 ? "day" : r.days <= 190 ? "week" : "month";
}

const bucketStart = (d: Date, unit: "day" | "week" | "month") => {
  if (unit === "month") return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const day = startOfDay(d);
  if (unit === "week") return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY);
  return day;
};

export function buckets(r: Range, unit = bucketFor(r)) {
  const out: Date[] = [];
  let cur = bucketStart(r.from, unit);
  while (cur < r.to) {
    out.push(cur);
    cur = unit === "month" ? new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1)) : new Date(cur.getTime() + (unit === "week" ? 7 : 1) * DAY);
  }
  return out;
}

const pct = (cur: number, prev: number) => (prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10);
const liveInvoice = (from: Date, to: Date): SQL => and(gte(invoices.issuedAt, from), lt(invoices.issuedAt, to), ne(invoices.status, "void"))!;

async function invoiceTotals(db: DB, from: Date, to: Date) {
  const [r] = await db
    .select({ count: sql<number>`count(*)::int`, net: sql<number>`coalesce(sum(${invoices.subtotalMinor} - ${invoices.discountMinor}), 0)::bigint`, tax: sql<number>`coalesce(sum(${invoices.taxMinor}), 0)::bigint` })
    .from(invoices)
    .where(liveInvoice(from, to));
  return { count: Number(r!.count), net: Number(r!.net), tax: Number(r!.tax) };
}

/** Revenue and cost of stock items on orders fulfilled in the period: SES stock at recorded cost, partner lines at partner cost. */
async function stockMargin(db: DB, from: Date, to: Date) {
  const fulfilled = and(eq(orders.status, "fulfilled"), gte(orders.fulfilledAt, from), lt(orders.fulfilledAt, to));
  const [own] = await db
    .select({ cogs: sql<number>`coalesce(sum(-${stockMovements.quantity} * coalesce(${stockMovements.unitCostMinor}, 0)), 0)::bigint`, units: sql<number>`coalesce(sum(-${stockMovements.quantity}), 0)::int` })
    .from(stockMovements)
    .innerJoin(orders, sql`${orders.id}::text = ${stockMovements.refId}`)
    .where(and(eq(stockMovements.reason, "fulfilment"), eq(stockMovements.refType, "order"), fulfilled));
  const [rev] = await db
    .select({ v: sql<number>`coalesce(sum(${orderLines.lineTotalMinor}), 0)::bigint` })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderLines.variantId))
    .where(and(fulfilled, eq(productVariants.tracksStock, true)));
  const [partner] = await db
    .select({ cost: sql<number>`coalesce(sum(${orderLines.quantity} * coalesce(${productMappings.partnerCostMinor}, 0)), 0)::bigint` })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(productMappings, and(eq(productMappings.variantId, orderLines.variantId), eq(productMappings.connectionId, orderLines.fulfilmentConnectionId)))
    .where(and(fulfilled, isNotNull(orderLines.fulfilmentConnectionId)));
  return { revenue: Number(rev!.v), cogs: Number(own!.cogs) + Number(partner!.cost), units: Number(own!.units) };
}

// ───────────────────────────── Sales ─────────────────────────────

export async function salesReport(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  const [cur, prev, m, pm] = await Promise.all([invoiceTotals(db, r.from, r.to), invoiceTotals(db, r.prevFrom, r.prevTo), stockMargin(db, r.from, r.to), stockMargin(db, r.prevFrom, r.prevTo)]);
  const unit = bucketFor(r);
  const rows = await db
    .select({ at: invoices.issuedAt, net: sql<number>`(${invoices.subtotalMinor} - ${invoices.discountMinor})::bigint`, source: orders.source, subscriptionId: invoices.subscriptionId })
    .from(invoices)
    .leftJoin(orders, eq(orders.id, invoices.orderId))
    .where(liveInvoice(r.from, r.to));
  const series = buckets(r, unit).map((b) => ({ at: b, value: 0 }));
  const channels = new Map<string, { label: string; value: number; count: number }>();
  const channelLabel: Record<string, string> = { quote: "Quotations", store: "Online store", subscription: "Subscriptions & contracts" };
  for (const x of rows) {
    const start = bucketStart(x.at, unit).getTime();
    const s = series.find((p) => p.at.getTime() === start);
    if (s) s.value += Number(x.net);
    const key = x.subscriptionId ? "subscription" : (x.source ?? "other");
    const c = channels.get(key) ?? { label: channelLabel[key] ?? "Other invoices", value: 0, count: 0 };
    c.value += Number(x.net);
    c.count++;
    channels.set(key, c);
  }
  const margin = m.revenue - m.cogs;
  return {
    unit,
    series,
    kpis: {
      net: { value: cur.net, change: pct(cur.net, prev.net) },
      invoices: { value: cur.count, change: pct(cur.count, prev.count) },
      average: { value: cur.count ? Math.round(cur.net / cur.count) : 0, change: pct(cur.count ? cur.net / cur.count : 0, prev.count ? prev.net / prev.count : 0) },
      tax: { value: cur.tax, change: pct(cur.tax, prev.tax) },
      margin: { value: margin, change: pct(margin, pm.revenue - pm.cogs) },
      marginPct: m.revenue ? Math.round((margin / m.revenue) * 1000) / 10 : null,
      unitsSold: m.units,
    },
    channels: [...channels.values()].sort((a, b) => b.value - a.value),
  };
}

export async function productPerformance(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  const fulfilled = and(eq(orders.status, "fulfilled"), gte(orders.fulfilledAt, r.from), lt(orders.fulfilledAt, r.to));
  const lines = await db
    .select({
      variantId: orderLines.variantId,
      sku: productVariants.sku,
      name: products.name,
      variantName: productVariants.name,
      categoryName: categories.name,
      brandName: brands.name,
      qty: sql<number>`sum(${orderLines.quantity})::int`,
      revenue: sql<number>`sum(${orderLines.lineTotalMinor})::bigint`,
      partnerCost: sql<number>`sum(case when ${orderLines.fulfilmentConnectionId} is not null then ${orderLines.quantity} * coalesce(${productMappings.partnerCostMinor}, 0) else 0 end)::bigint`,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .innerJoin(productVariants, eq(productVariants.id, orderLines.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(brands, eq(brands.id, products.brandId))
    .leftJoin(productMappings, and(eq(productMappings.variantId, orderLines.variantId), eq(productMappings.connectionId, orderLines.fulfilmentConnectionId)))
    .where(fulfilled)
    .groupBy(orderLines.variantId, productVariants.sku, products.name, productVariants.name, categories.name, brands.name);
  const own = await db
    .select({ variantId: stockMovements.variantId, cost: sql<number>`sum(-${stockMovements.quantity} * coalesce(${stockMovements.unitCostMinor}, 0))::bigint` })
    .from(stockMovements)
    .innerJoin(orders, sql`${orders.id}::text = ${stockMovements.refId}`)
    .where(and(eq(stockMovements.reason, "fulfilment"), eq(stockMovements.refType, "order"), fulfilled))
    .groupBy(stockMovements.variantId);
  const ownCost = new Map(own.map((c) => [c.variantId, Number(c.cost)]));
  const rows = lines
    .map((l) => {
      const revenue = Number(l.revenue);
      const has = ownCost.has(l.variantId!) || Number(l.partnerCost) > 0;
      const cost = has ? (ownCost.get(l.variantId!) ?? 0) + Number(l.partnerCost) : null;
      return { ...l, name: l.variantName === "Standard" ? l.name : `${l.name} — ${l.variantName}`, revenue, cost, margin: cost === null ? null : revenue - cost, marginPct: cost === null || revenue === 0 ? null : Math.round(((revenue - cost) / revenue) * 1000) / 10 };
    })
    .sort((a, b) => b.revenue - a.revenue);
  const total = rows.reduce((a, x) => a + x.revenue, 0);
  let running = 0;
  const ranked = rows.map((x) => {
    running += x.revenue;
    const share = total ? running / total : 1;
    return { ...x, abc: share <= 0.8 || running === x.revenue ? "A" : share <= 0.95 ? "B" : "C" };
  });
  const rollup = (key: "categoryName" | "brandName") => {
    const m = new Map<string, { label: string; revenue: number; margin: number; qty: number }>();
    for (const x of ranked) {
      const label = x[key] ?? "None";
      const cur = m.get(label) ?? { label, revenue: 0, margin: 0, qty: 0 };
      cur.revenue += x.revenue;
      cur.margin += x.margin ?? 0;
      cur.qty += x.qty;
      m.set(label, cur);
    }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue);
  };
  return { rows: ranked, total, byCategory: rollup("categoryName"), byBrand: rollup("brandName") };
}

export async function topCustomers(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  const rows = await db
    .select({ id: organizations.id, name: organizations.name, invoices: sql<number>`count(*)::int`, net: sql<number>`sum(${invoices.subtotalMinor} - ${invoices.discountMinor})::bigint` })
    .from(invoices)
    .innerJoin(organizations, eq(organizations.id, invoices.customerOrgId))
    .where(liveInvoice(r.from, r.to))
    .groupBy(organizations.id, organizations.name)
    .orderBy(sql`sum(${invoices.subtotalMinor} - ${invoices.discountMinor}) desc`)
    .limit(20);
  return rows.map((x) => ({ ...x, company: null as string | null, net: Number(x.net) }));
}

// ───────────────────────────── Finance & tax ─────────────────────────────

export async function taxReport(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  authorize(actor, "finance.read");
  const rows = await db.select({ at: invoices.issuedAt, net: sql<number>`(${invoices.subtotalMinor} - ${invoices.discountMinor})::bigint`, breakdown: invoices.taxBreakdown }).from(invoices).where(liveInvoice(r.from, r.to)).orderBy(asc(invoices.issuedAt));
  const codes = new Map<string, string>();
  const months = new Map<string, { month: string; net: number; taxes: Record<string, number>; total: number }>();
  for (const x of rows) {
    const key = x.at.toISOString().slice(0, 7);
    const m = months.get(key) ?? { month: key, net: 0, taxes: {}, total: 0 };
    m.net += Number(x.net);
    for (const t of x.breakdown ?? []) {
      codes.set(t.code, t.name);
      m.taxes[t.code] = (m.taxes[t.code] ?? 0) + t.amountMinor;
      m.total += t.amountMinor;
    }
    months.set(key, m);
  }
  const list = [...months.values()];
  return { codes: [...codes.entries()].map(([code, name]) => ({ code, name })), months: list, totals: { net: list.reduce((a, m) => a + m.net, 0), tax: list.reduce((a, m) => a + m.total, 0), byCode: Object.fromEntries([...codes.keys()].map((c) => [c, list.reduce((a, m) => a + (m.taxes[c] ?? 0), 0)])) } };
}

export const METHOD_LABELS: Record<string, string> = { mobile_money: "Mobile money", bank_transfer: "Bank transfer", cash: "Cash", cheque: "Cheque", card: "Card (Paystack)", bank: "Bank (Paystack)", paystack: "Paystack", manual: "Recorded by staff" };

export async function paymentsReport(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  authorize(actor, "finance.read");
  const key = sql<string>`coalesce(${payments.method}, ${payments.channel}, ${payments.provider})`;
  const rows = await db
    .select({ method: key, n: sql<number>`count(*)::int`, total: sql<number>`sum(${payments.amountMinor})::bigint` })
    .from(payments)
    .where(and(eq(payments.status, "success"), isNotNull(payments.paidAt), gte(payments.paidAt, r.from), lt(payments.paidAt, r.to)))
    .groupBy(key);
  return rows.map((x) => ({ label: METHOD_LABELS[x.method] ?? x.method, count: x.n, value: Number(x.total) })).sort((a, b) => b.value - a.value);
}

export async function receivablesAging(db: DB, actor: Actor, now = new Date()) {
  authorize(actor, "reports.read");
  authorize(actor, "finance.read");
  const open = await db
    .select({ id: invoices.id, number: invoices.number, billTo: organizations.name, dueAt: invoices.dueAt, total: invoices.totalMinor, paid: invoices.paidMinor })
    .from(invoices)
    .innerJoin(organizations, eq(organizations.id, invoices.customerOrgId))
    .where(inArray(invoices.status, ["issued", "part_paid"]));
  const buckets = [
    { key: "current", label: "Not yet due", value: 0, count: 0 },
    { key: "1-30", label: "1–30 days overdue", value: 0, count: 0 },
    { key: "31-60", label: "31–60 days", value: 0, count: 0 },
    { key: "61-90", label: "61–90 days", value: 0, count: 0 },
    { key: "90+", label: "Over 90 days", value: 0, count: 0 },
  ];
  const list = open.map((i) => {
    const balance = Number(i.total) - Number(i.paid);
    const late = i.dueAt ? Math.floor((now.getTime() - i.dueAt.getTime()) / DAY) : 0;
    const b = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    buckets[b]!.value += balance;
    buckets[b]!.count++;
    return { ...i, balance, daysOverdue: Math.max(0, late) };
  });
  return { buckets, invoices: list.filter((x) => x.balance > 0).sort((a, b) => b.daysOverdue - a.daysOverdue), total: list.reduce((a, x) => a + x.balance, 0) };
}

// ───────────────────────────── Inventory ─────────────────────────────

export async function inventoryReport(db: DB, actor: Actor, r: Range, now = new Date()) {
  authorize(actor, "reports.read");
  authorize(actor, "inventory.read");
  const stock = await stockOverview(db, actor);
  const since90 = new Date(now.getTime() - 90 * DAY);
  const sales90 = await db
    .select({ variantId: stockMovements.variantId, units: sql<number>`sum(-${stockMovements.quantity})::int` })
    .from(stockMovements)
    .where(and(eq(stockMovements.reason, "fulfilment"), gte(stockMovements.createdAt, since90)))
    .groupBy(stockMovements.variantId);
  const lastSale = await db.select({ variantId: stockMovements.variantId, last: sql<string>`max(${stockMovements.createdAt})` }).from(stockMovements).where(eq(stockMovements.reason, "fulfilment")).groupBy(stockMovements.variantId);
  const sold = new Map(sales90.map((s) => [s.variantId, Number(s.units)]));
  const lastOf = new Map(lastSale.map((s) => [s.variantId, new Date(s.last)]));
  const value = stock.reduce((a, s) => a + s.valueMinor, 0);
  const [c90] = await db
    .select({ cogs: sql<number>`coalesce(sum(-${stockMovements.quantity} * coalesce(${stockMovements.unitCostMinor}, 0)), 0)::bigint` })
    .from(stockMovements)
    .where(and(eq(stockMovements.reason, "fulfilment"), gte(stockMovements.createdAt, since90)));
  const turnover = value > 0 ? Math.round(((Number(c90!.cogs) * 365) / 90 / value) * 10) / 10 : null;
  const items = stock.map((s) => {
    const own = s.levels.filter((l) => !l.connectionId).reduce((a, l) => a + l.onHand, 0);
    const daily = (sold.get(s.variantId) ?? 0) / 90;
    const last = lastOf.get(s.variantId) ?? null;
    const ownAvailable = s.available - s.partnerAvailable;
    return { ...s, ownOnHand: own, dailyDemand: Math.round(daily * 100) / 100, daysOfCover: daily > 0 ? Math.round(ownAvailable / daily) : null, lastSale: last, idleDays: last ? Math.floor((now.getTime() - last.getTime()) / DAY) : null };
  });
  const dead = items.filter((i) => i.ownOnHand > 0 && (i.idleDays === null || i.idleDays > 90)).sort((a, b) => b.valueMinor - a.valueMinor);
  const byCategory = new Map<string, { label: string; value: number; units: number }>();
  for (const i of items) {
    const label = i.categoryName ?? "No category";
    const c = byCategory.get(label) ?? { label, value: 0, units: 0 };
    c.value += i.valueMinor;
    c.units += i.ownOnHand;
    byCategory.set(label, c);
  }
  const locs = await db.select().from(stockLocations).where(isNull(stockLocations.connectionId)).orderBy(asc(stockLocations.name));
  const byLocation = locs
    .map((l) => ({ label: l.name, value: items.reduce((a, i) => a + (i.levels.find((x) => x.locationId === l.id)?.onHand ?? 0) * (i.costMinor ?? 0), 0), units: items.reduce((a, i) => a + (i.levels.find((x) => x.locationId === l.id)?.onHand ?? 0), 0) }))
    .filter((l) => l.units > 0);
  const losses = await db
    .select({ reason: stockMovements.reason, units: sql<number>`sum(-${stockMovements.quantity})::int`, value: sql<number>`sum(-${stockMovements.quantity} * coalesce(${stockMovements.unitCostMinor}, 0))::bigint` })
    .from(stockMovements)
    .where(and(inArray(stockMovements.reason, ["damaged", "lost", "expired", "internal_use", "count", "correction", "found"]), gte(stockMovements.createdAt, r.from), lt(stockMovements.createdAt, r.to)))
    .groupBy(stockMovements.reason);
  return {
    value,
    units: items.reduce((a, i) => a + i.ownOnHand, 0),
    turnover,
    outOfStock: items.filter((i) => i.status === "out_of_stock").length,
    byCategory: [...byCategory.values()].sort((a, b) => b.value - a.value),
    byLocation,
    dead,
    lowCover: items.filter((i) => i.daysOfCover !== null && i.daysOfCover <= 14).sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0)),
    losses: losses.map((l) => ({ reason: l.reason, units: Number(l.units), value: Number(l.value) })),
  };
}

/** Holt's double exponential smoothing on weekly totals (picks up a rising or falling trend). */
export function holtForecast(weekly: number[], alpha = 0.4, beta = 0.2) {
  if (weekly.length === 0) return { level: 0, trend: 0, next: 0 };
  let level = weekly[0]!;
  let trend = weekly.length > 1 ? weekly[1]! - weekly[0]! : 0;
  for (let i = 1; i < weekly.length; i++) {
    const prevLevel = level;
    level = alpha * weekly[i]! + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  return { level, trend, next: Math.max(0, level + trend) };
}

/** Demand forecast for SES-held stock (partner stock is the partner's to plan). */
export async function forecastReport(db: DB, actor: Actor, now = new Date()) {
  authorize(actor, "reports.read");
  authorize(actor, "inventory.read");
  const WEEKS = 12;
  const start = new Date(startOfDay(now).getTime() - WEEKS * 7 * DAY);
  const moves = await db
    .select({ variantId: stockMovements.variantId, at: stockMovements.createdAt, units: sql<number>`-${stockMovements.quantity}` })
    .from(stockMovements)
    .where(and(eq(stockMovements.reason, "fulfilment"), gte(stockMovements.createdAt, start)));
  const weeklyOf = new Map<string, number[]>();
  for (const m of moves) {
    const w = Math.min(WEEKS - 1, Math.floor((m.at.getTime() - start.getTime()) / (7 * DAY)));
    const arr = weeklyOf.get(m.variantId) ?? Array(WEEKS).fill(0);
    arr[w] += Number(m.units);
    weeklyOf.set(m.variantId, arr);
  }
  const stock = await stockOverview(db, actor);
  const onOrder = await onOrderByVariant(db);
  const Z = 1.65;
  const REVIEW_WEEKS = 2;
  const rows = stock
    .filter((s) => weeklyOf.has(s.variantId) || s.reorderPoint !== null)
    .map((s) => {
      const weekly = weeklyOf.get(s.variantId) ?? Array(WEEKS).fill(0);
      const f = holtForecast(weekly);
      const mean = weekly.reduce((a, b) => a + b, 0) / WEEKS;
      const sd = Math.sqrt(weekly.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, WEEKS - 1));
      const ltWeeks = (s.leadTimeDays ?? 7) / 7;
      const safety = Math.ceil(Z * sd * Math.sqrt(ltWeeks));
      const available = s.available - s.partnerAvailable;
      const coming = onOrder.get(s.variantId) ?? 0;
      const target = Math.ceil(f.next * (ltWeeks + REVIEW_WEEKS) + safety);
      const weeksLeft = f.next > 0 ? available / f.next : null;
      return {
        ...s,
        available,
        weekly,
        forecastWeekly: Math.round(f.next * 10) / 10,
        trend: Math.round(f.trend * 10) / 10,
        safetyStock: safety,
        suggestedReorderPoint: Math.ceil(f.next * ltWeeks + safety),
        onOrder: coming,
        suggestedOrder: Math.max(0, target - available - coming),
        stockoutDate: weeksLeft === null ? null : new Date(now.getTime() + weeksLeft * 7 * DAY),
      };
    })
    .sort((a, b) => (a.stockoutDate?.getTime() ?? Infinity) - (b.stockoutDate?.getTime() ?? Infinity));
  return { weeks: WEEKS, rows };
}

// ───────────────────────────── Procurement ─────────────────────────────

export async function purchasingReport(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  authorize(actor, "procurement.read");
  const received = await db
    .select({ supplier: suppliers.name, value: sql<number>`coalesce(sum(${stockMovements.quantity} * coalesce(${stockMovements.unitCostMinor}, 0)), 0)::bigint`, units: sql<number>`coalesce(sum(${stockMovements.quantity}), 0)::int` })
    .from(stockMovements)
    .innerJoin(goodsReceipts, sql`${goodsReceipts.id}::text = ${stockMovements.refId}`)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.purchaseOrderId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(eq(stockMovements.reason, "receipt"), eq(stockMovements.refType, "goods_receipt"), gte(stockMovements.createdAt, r.from), lt(stockMovements.createdAt, r.to)))
    .groupBy(suppliers.name);
  const firsts = await db
    .select({ supplier: suppliers.name, expected: purchaseOrders.expectedAt, first: sql<string>`min(${goodsReceipts.createdAt})` })
    .from(goodsReceipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.purchaseOrderId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(isNotNull(purchaseOrders.expectedAt), gte(goodsReceipts.createdAt, r.from), lt(goodsReceipts.createdAt, r.to)))
    .groupBy(suppliers.name, purchaseOrders.id, purchaseOrders.expectedAt);
  const perf = new Map<string, { onTime: number; total: number }>();
  for (const f of firsts) {
    const p = perf.get(f.supplier) ?? { onTime: 0, total: 0 };
    p.total++;
    if (new Date(f.first).getTime() <= f.expected!.getTime() + DAY) p.onTime++;
    perf.set(f.supplier, p);
  }
  const [open] = await db
    .select({ n: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${purchaseOrders.totalMinor}), 0)::bigint` })
    .from(purchaseOrders)
    .where(inArray(purchaseOrders.status, ["draft", "pending_approval", "approved", "sent", "partially_received"]));
  return {
    bySupplier: received.map((x) => ({ label: x.supplier, value: Number(x.value), units: x.units, onTimePct: perf.get(x.supplier) ? Math.round((perf.get(x.supplier)!.onTime / perf.get(x.supplier)!.total) * 100) : null })).sort((a, b) => b.value - a.value),
    spend: received.reduce((a, x) => a + Number(x.value), 0),
    openOrders: { count: open!.n, value: Number(open!.value) },
  };
}

// ───────────────────────────── Pipeline ─────────────────────────────

/** Leads → quotations → won, by lead source and by service interest. */
export async function pipelineReport(db: DB, actor: Actor, r: Range) {
  authorize(actor, "reports.read");
  const lead = await db
    .select({ source: leads.source, interest: leads.serviceInterest, status: leads.status, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(gte(leads.createdAt, r.from), lt(leads.createdAt, r.to)))
    .groupBy(leads.source, leads.serviceInterest, leads.status);
  const qs = await db
    .select({ status: quotes.status, n: sql<number>`count(*)::int`, value: sql<number>`coalesce(sum(${quotes.totalMinor}), 0)::bigint` })
    .from(quotes)
    .where(and(gte(quotes.createdAt, r.from), lt(quotes.createdAt, r.to)))
    .groupBy(quotes.status);
  const sum = (arr: { n: number }[]) => arr.reduce((a, x) => a + x.n, 0);
  const group = (key: "source" | "interest") => {
    const m = new Map<string, { label: string; leads: number; won: number; lost: number }>();
    for (const l of lead) {
      const label = (l[key] ?? "Not given") || "Not given";
      const c = m.get(label) ?? { label, leads: 0, won: 0, lost: 0 };
      c.leads += l.n;
      if (l.status === "won") c.won += l.n;
      if (l.status === "lost") c.lost += l.n;
      m.set(label, c);
    }
    return [...m.values()].map((x) => ({ ...x, winRate: x.won + x.lost ? Math.round((x.won / (x.won + x.lost)) * 100) : null })).sort((a, b) => b.leads - a.leads);
  };
  const sent = sum(qs.filter((q) => ["sent", "accepted", "declined", "expired"].includes(q.status)));
  const won = qs.filter((q) => q.status === "accepted");
  return {
    totals: { leads: sum(lead), quotes: sum(qs), sent, won: sum(won), wonValue: won.reduce((a, q) => a + Number(q.value), 0), winRate: sent ? Math.round((sum(won) / sent) * 100) : null },
    bySource: group("source"),
    byInterest: group("interest"),
  };
}

// ───────────────────────────── Weekly summary e-mail ─────────────────────────────

/** Monday-morning summary of the last 7 days for everyone who can read reports, limited to each person's permissions. */
export async function sendWeeklyDigest(db: DB, now = new Date()) {
  const settings = await getSettings(db);
  if (!settings.weeklyReport) return 0;
  const r = parseRange({ range: "7d" }, now);
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const change = (c: number | null) => (c === null ? " (new)" : c === 0 ? "" : ` (${c > 0 ? "+" : ""}${c}% vs the week before)`);
  let sent = 0;
  for (const id of await usersWithPermission(db, "reports.read")) {
    const actor = await loadActor(db, id, { id: "weekly-digest", mfaVerified: true });
    if (!actor) continue;
    const s = await salesReport(db, actor, r);
    const lines = [
      `Hello ${actor.name},`,
      "",
      `Here is ${settings.companyName}'s week: ${r.from.toISOString().slice(0, 10)} to ${new Date(r.to.getTime() - 1).toISOString().slice(0, 10)}.`,
      "",
      `Net sales: ${formatMoney(s.kpis.net.value)}${change(s.kpis.net.change)}`,
      `Invoices issued: ${s.kpis.invoices.value}`,
      `Gross margin on stock items: ${formatMoney(s.kpis.margin.value)}${s.kpis.marginPct === null ? "" : ` (${s.kpis.marginPct}%)`}`,
    ];
    if (can(actor, "finance.read")) {
      const [pay, aging] = await Promise.all([paymentsReport(db, actor, r), receivablesAging(db, actor, now)]);
      lines.push(`Payments received: ${formatMoney(pay.reduce((a, p) => a + p.value, 0))}`, `Overdue invoices: ${formatMoney(aging.buckets.slice(1).reduce((a, b) => a + b.value, 0))}`);
    }
    if (can(actor, "inventory.read")) {
      const reorder = await reorderList(db, actor);
      lines.push(`SES items at or below their reorder point: ${reorder.length}${reorder.length ? ` (${reorder.slice(0, 5).map((x) => x.sku).join(", ")}${reorder.length > 5 ? " …" : ""})` : ""}`);
    }
    const top = (await productPerformance(db, actor, r)).rows.slice(0, 5);
    if (top.length) lines.push("", "Best sellers:", ...top.map((t) => `- ${t.name}: ${t.qty} sold, ${formatMoney(t.revenue)}`));
    lines.push("", `Full reports: ${base}/ops/reports`, "", "You receive this because you can view reports. An administrator can turn it off in Company settings.");
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, id));
    if (!u?.email) continue;
    await sendMail(db, { to: u.email, subject: `Weekly summary — ${settings.companyName}`, body: lines.join("\n") });
    sent++;
  }
  return sent;
}
