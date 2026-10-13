import { asc, desc, eq, inArray } from "drizzle-orm";
import { MOVEMENT_LABELS, searchMovements, stockOverview } from "./inventory";
import type { DB } from "../db/client";
import {
  assets,
  categories,
  invoices,
  leads,
  orders,
  organizations,
  payments,
  products,
  productVariants,
  projects,
  purchaseOrders,
  returnRequests,
  stockLevels,
  stockLocations,
  subscriptions,
  suppliers,
  tickets,
} from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import type { Permission } from "../authz/permissions";
import { invalid } from "../lib/errors";
import { parseMoney } from "../lib/money";
import { audit } from "./audit";
import { addVariant, createProduct, PRODUCT_TYPES, requestPriceChange, updateProduct, type ProductType } from "./catalogue";

// ───────────────────────────── CSV primitives ─────────────────────────────

/**
 * One CSV cell. Values that a spreadsheet would treat as a formula (= + - @, tab, CR) are prefixed with an
 * apostrophe, so an exported file can never run a formula when opened in Excel (CSV injection).
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]) {
  // BOM so Excel opens UTF-8 (e.g. "₵", accented names) correctly.
  return "﻿" + [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** RFC 4180 parser (quoted fields, escaped quotes, CRLF/LF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw invalid("The file has an unclosed quote.");
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

// ───────────────────────────── Exports ─────────────────────────────

export const EXPORTS: Record<string, { label: string; perm: Permission }> = {
  leads: { label: "Leads", perm: "leads.read" },
  orders: { label: "Orders", perm: "orders.read" },
  products: { label: "Products & prices", perm: "catalogue.read" },
  stock: { label: "Stock levels and value", perm: "inventory.read" },
  movements: { label: "Stock movements (ledger)", perm: "inventory.read" },
  "purchase-orders": { label: "Purchase orders", perm: "procurement.read" },
  returns: { label: "Returns & warranty claims", perm: "returns.manage" },
  invoices: { label: "Invoices", perm: "finance.read" },
  payments: { label: "Payments received", perm: "finance.read" },
  tickets: { label: "Support tickets (with SLA outcome)", perm: "support.read" },
  subscriptions: { label: "Subscriptions", perm: "orders.read" },
  projects: { label: "Projects", perm: "projects.read" },
  assets: { label: "Customer assets", perm: "support.read" },
};

const money = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : (minor / 100).toFixed(2));

/** Bulk export: needs data.export plus read access to the data itself. Every export is audited. */
const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : undefined);

/** Optional filters come from the page the export was started on (?q=&location=&category=&low=1, ?from=&to=&reason=). */
export async function exportCsv(db: DB, actor: Actor, kind: string, params: URLSearchParams = new URLSearchParams()) {
  const def = EXPORTS[kind];
  if (!def) throw invalid("Unknown export.");
  authorize(actor, "data.export");
  authorize(actor, def.perm);
  let header: string[];
  let rows: unknown[][];
  switch (kind) {
    case "leads": {
      const r = await db.select().from(leads).orderBy(desc(leads.createdAt));
      header = ["number", "created_at", "status", "contact_name", "email", "phone", "company", "service_interest", "message"];
      rows = r.map((l) => [l.number, l.createdAt, l.status, l.contactName, l.email, l.phone, l.companyName, l.serviceInterest, l.message]);
      break;
    }
    case "orders": {
      const r = await db
        .select({ o: orders, customer: organizations.name })
        .from(orders)
        .innerJoin(organizations, eq(organizations.id, orders.customerOrgId))
        .orderBy(desc(orders.createdAt));
      header = ["number", "created_at", "customer", "status", "payment_status", "currency", "subtotal", "discount", "tax", "total", "fulfilled_at"];
      rows = r.map(({ o, customer }) => [o.number, o.createdAt, customer, o.status, o.paymentStatus, o.currency, money(o.subtotalMinor), money(o.discountMinor), money(o.taxMinor), money(o.totalMinor), o.fulfilledAt]);
      break;
    }
    case "products": {
      const r = await db
        .select({ v: productVariants, p: products, category: categories.slug })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .orderBy(asc(products.name), asc(productVariants.sku));
      header = IMPORT_COLUMNS;
      rows = r.map(({ v, p, category }) => [
        v.sku, p.name, v.name, p.type, category ?? "", money(v.priceMinor), v.taxable ? "yes" : "no", v.tracksStock ? "yes" : "no", v.billingPeriod ?? "", v.warrantyMonths, p.status, p.summary ?? "",
      ]);
      break;
    }
    case "stock": {
      const r = await stockOverview(db, actor, { q: params.get("q") ?? undefined, locationId: params.get("location") || undefined, categoryId: params.get("category") || undefined, lowOnly: params.get("low") === "1" });
      header = ["sku", "barcode", "item", "category", "ses_on_hand", "reserved", "available", "partner_available", "status", "reorder_point", "reorder_qty", "average_cost", "value", "locations"];
      rows = r.map((x) => [x.sku, x.barcode, x.name, x.categoryName, x.onHand, x.reserved, x.available, x.partnerAvailable, x.status, x.reorderPoint, x.reorderQty, money(x.costMinor), money(x.valueMinor), x.levels.map((l) => `${l.locationCode}: ${l.onHand}`).join("; ")]);
      break;
    }
    case "movements": {
      const to = day(params.get("to"));
      const r = await searchMovements(db, actor, { from: day(params.get("from")), to: to && new Date(to.getTime() + 86_400_000), reason: params.get("reason") || undefined, locationId: params.get("location") || undefined, q: params.get("q") ?? undefined, limit: 5000 });
      header = ["when", "sku", "item", "location", "change", "reason", "unit_cost", "value", "reference", "note", "by"];
      rows = r.map((x) => [x.m.createdAt, x.sku, x.productName, x.locationName, x.m.quantity, MOVEMENT_LABELS[x.m.reason] ?? x.m.reason, money(x.m.unitCostMinor), money(x.m.unitCostMinor === null ? null : x.m.unitCostMinor * x.m.quantity), x.m.refType ? `${x.m.refType}:${x.m.refId}` : "", x.m.note, x.actorName]);
      break;
    }
    case "purchase-orders": {
      const r = await db
        .select({ po: purchaseOrders, supplier: suppliers.name })
        .from(purchaseOrders)
        .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .orderBy(desc(purchaseOrders.createdAt));
      header = ["number", "created_at", "supplier", "status", "currency", "total", "expected_at", "sent_at"];
      rows = r.map(({ po, supplier }) => [po.number, po.createdAt, supplier, po.status, po.currency, money(po.totalMinor), po.expectedAt, po.sentAt]);
      break;
    }
    case "invoices": {
      const r = await db
        .select({ i: invoices, customer: organizations.name, order: orders.number })
        .from(invoices)
        .innerJoin(organizations, eq(organizations.id, invoices.customerOrgId))
        .leftJoin(orders, eq(orders.id, invoices.orderId))
        .orderBy(desc(invoices.issuedAt));
      header = ["number", "issued_at", "due_at", "customer", "order", "status", "currency", "subtotal", "discount", "tax", "total", "paid", "balance", "customer_reference"];
      rows = r.map(({ i, customer, order }) => [i.number, i.issuedAt, i.dueAt, customer, order, i.status, i.currency, money(i.subtotalMinor), money(i.discountMinor), money(i.taxMinor), money(i.totalMinor), money(i.paidMinor), money(i.status === "void" ? 0 : i.totalMinor - i.paidMinor), i.customerReference]);
      break;
    }
    case "payments": {
      const r = await db
        .select({ p: payments, invoice: invoices.number, customer: organizations.name })
        .from(payments)
        .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
        .innerJoin(organizations, eq(organizations.id, invoices.customerOrgId))
        .where(inArray(payments.status, ["success", "reversed"]))
        .orderBy(desc(payments.paidAt));
      header = ["paid_at", "invoice", "customer", "status", "provider", "method", "amount", "currency", "reference", "external_reference", "mode"];
      rows = r.map(({ p, invoice, customer }) => [p.paidAt, invoice, customer, p.status, p.provider, p.method, money(p.amountMinor), p.currency, p.reference, p.externalReference, p.mode]);
      break;
    }
    case "tickets": {
      const r = await db
        .select({ t: tickets, customer: organizations.name })
        .from(tickets)
        .innerJoin(organizations, eq(organizations.id, tickets.customerOrgId))
        .orderBy(desc(tickets.createdAt));
      header = ["number", "created_at", "customer", "subject", "category", "priority", "status", "level", "coverage", "response_due_at", "first_responded_at", "response_breached", "resolution_due_at", "resolved_at", "resolution_breached"];
      rows = r.map(({ t, customer }) => [t.number, t.createdAt, customer, t.subject, t.category, t.priority, t.status, t.level, t.coverage, t.responseDueAt, t.firstRespondedAt, t.responseBreached ? "yes" : "no", t.resolutionDueAt, t.resolvedAt, t.resolutionBreached ? "yes" : "no"]);
      break;
    }
    case "subscriptions": {
      const r = await db
        .select({ s: subscriptions, customer: organizations.name })
        .from(subscriptions)
        .innerJoin(organizations, eq(organizations.id, subscriptions.customerOrgId))
        .orderBy(asc(subscriptions.currentPeriodEnd));
      header = ["number", "customer", "description", "quantity", "unit_price", "currency", "billing_period", "status", "auto_renew", "current_period_start", "current_period_end", "ended_at", "end_reason"];
      rows = r.map(({ s, customer }) => [s.number, customer, s.description, s.quantity, money(s.unitPriceMinor), s.currency, s.billingPeriod, s.status, s.autoRenew ? "yes" : "no", s.currentPeriodStart, s.currentPeriodEnd, s.endedAt, s.endReason]);
      break;
    }
    case "projects": {
      const r = await db
        .select({ p: projects, customer: organizations.name })
        .from(projects)
        .leftJoin(organizations, eq(organizations.id, projects.customerOrgId))
        .orderBy(desc(projects.createdAt));
      header = ["number", "name", "customer", "status", "start_date", "due_date", "completed_at"];
      rows = r.map(({ p, customer }) => [p.number, p.name, customer ?? "internal", p.status, p.startDate, p.dueDate, p.completedAt]);
      break;
    }
    case "assets": {
      const r = await db
        .select({ a: assets, customer: organizations.name })
        .from(assets)
        .innerJoin(organizations, eq(organizations.id, assets.customerOrgId))
        .orderBy(asc(assets.tag));
      header = ["tag", "customer", "name", "serial_number", "location", "status", "installed_at"];
      rows = r.map(({ a, customer }) => [a.tag, customer, a.name, a.serialNumber, a.location, a.status, a.installedAt]);
      break;
    }
    default: {
      const r = await db
        .select({ r: returnRequests, order: orders.number, customer: organizations.name })
        .from(returnRequests)
        .innerJoin(orders, eq(orders.id, returnRequests.orderId))
        .innerJoin(organizations, eq(organizations.id, returnRequests.customerOrgId))
        .orderBy(desc(returnRequests.createdAt));
      header = ["number", "created_at", "order", "customer", "kind", "resolution", "status", "refund", "reason"];
      rows = r.map(({ r: x, order, customer }) => [x.number, x.createdAt, order, customer, x.kind, x.resolution, x.status, money(x.refundMinor), x.reason]);
    }
  }
  await audit(db, { actor, action: "data.exported", targetType: "export", targetId: kind, data: { rows: rows.length } });
  return { filename: `synclytics-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv(header, rows) };
}

// ───────────────────────────── Product import ─────────────────────────────

/** Same columns as the products export, so an export can be edited and re-imported. */
export const IMPORT_COLUMNS = ["sku", "product_name", "variant_name", "type", "category_slug", "price_ghs", "taxable", "tracks_stock", "billing_period", "warranty_months", "status", "summary"];
const MAX_IMPORT_ROWS = 1000;

export interface ImportRow {
  line: number;
  sku: string;
  action: "create_product" | "add_option" | "update" | "unchanged" | "error";
  changes: string[];
  errors: string[];
}

interface ParsedRow {
  line: number;
  sku: string;
  productName: string;
  variantName: string;
  type: ProductType;
  categorySlug: string;
  priceMinor: number;
  taxable: boolean;
  tracksStock: boolean;
  billingPeriod: "month" | "year" | null;
  warrantyMonths: number;
  status: "draft" | "active" | "retired";
  summary: string;
}

const yes = (v: string) => /^(yes|y|true|1)$/i.test(v.trim());

function parseRows(text: string): { rows: ParsedRow[]; errors: ImportRow[] } {
  if (text.length > 1_000_000) throw invalid("The file is too large (max 1 MB).");
  const table = parseCsv(text);
  if (table.length < 2) throw invalid("The file has no data rows.");
  const head = table[0]!.map((h) => h.trim().toLowerCase());
  const missing = IMPORT_COLUMNS.filter((c) => !head.includes(c));
  if (missing.length) throw invalid(`Missing columns: ${missing.join(", ")}. Export products first to get the template.`);
  if (table.length - 1 > MAX_IMPORT_ROWS) throw invalid(`At most ${MAX_IMPORT_ROWS} rows per import.`);
  const col = (r: string[], name: string) => (r[head.indexOf(name)] ?? "").trim().replace(/^'(?=[=+\-@])/, "");
  const rows: ParsedRow[] = [];
  const errors: ImportRow[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((r, i) => {
    const line = i + 2;
    const sku = col(r, "sku").toUpperCase();
    const errs: string[] = [];
    if (!/^[A-Z0-9][A-Z0-9-]{2,40}$/.test(sku)) errs.push("SKU must be 3–41 letters, digits or dashes");
    if (seen.has(sku)) errs.push("duplicate SKU in file");
    seen.add(sku);
    const type = col(r, "type") as ProductType;
    if (!(PRODUCT_TYPES as readonly string[]).includes(type)) errs.push(`type must be one of ${PRODUCT_TYPES.join(", ")}`);
    const price = parseMoney(col(r, "price_ghs"));
    if (price === null) errs.push("price_ghs must be a number such as 1250.00");
    const bp = col(r, "billing_period");
    if (bp && bp !== "month" && bp !== "year") errs.push("billing_period must be empty, month or year");
    const wm = Number(col(r, "warranty_months") || "0");
    if (!Number.isInteger(wm) || wm < 0 || wm > 120) errs.push("warranty_months must be 0–120");
    const status = (col(r, "status") || "draft") as ParsedRow["status"];
    if (!["draft", "active", "retired"].includes(status)) errs.push("status must be draft, active or retired");
    const productName = col(r, "product_name");
    if (productName.length < 3) errs.push("product_name is required");
    if (errs.length) {
      errors.push({ line, sku, action: "error", changes: [], errors: errs });
      return;
    }
    rows.push({
      line,
      sku,
      productName,
      variantName: col(r, "variant_name") || "Standard",
      type,
      categorySlug: col(r, "category_slug"),
      priceMinor: price!,
      taxable: yes(col(r, "taxable") || "yes"),
      tracksStock: yes(col(r, "tracks_stock") || "yes"),
      billingPeriod: (bp || null) as ParsedRow["billingPeriod"],
      warrantyMonths: wm,
      status,
      summary: col(r, "summary"),
    });
  });
  return { rows, errors };
}

async function plan(db: DB, text: string) {
  const { rows, errors } = parseRows(text);
  const variants = rows.length
    ? await db
        .select({ v: productVariants, p: products })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(inArray(productVariants.sku, rows.map((r) => r.sku)))
    : [];
  const cats = await db.select().from(categories);
  const productsByName = new Map((await db.select().from(products)).map((p) => [p.name.toLowerCase(), p]));
  const out: (ImportRow & { parsed?: ParsedRow; existing?: (typeof variants)[number]; categoryId?: string | null })[] = [...errors];
  for (const r of rows) {
    const changes: string[] = [];
    const errs: string[] = [];
    const cat = r.categorySlug ? cats.find((c) => c.slug === r.categorySlug) : null;
    if (r.categorySlug && !cat) errs.push(`unknown category_slug "${r.categorySlug}"`);
    const existing = variants.find((x) => x.v.sku === r.sku);
    let action: ImportRow["action"];
    if (existing) {
      const { v, p } = existing;
      if (p.name !== r.productName) changes.push(`name → ${r.productName}`);
      if ((p.summary ?? "") !== r.summary) changes.push("summary");
      if (p.status !== r.status) changes.push(`status ${p.status} → ${r.status}`);
      if (p.type !== r.type) errs.push("type cannot be changed by import");
      if ((cat?.id ?? null) !== p.categoryId && r.categorySlug) changes.push(`category → ${r.categorySlug}`);
      if (v.priceMinor !== r.priceMinor) changes.push(`price ${money(v.priceMinor)} → ${money(r.priceMinor)} (sensitive changes go for approval)`);
      if (v.warrantyMonths !== r.warrantyMonths) changes.push(`warranty ${v.warrantyMonths} → ${r.warrantyMonths} months`);
      if (v.taxable !== r.taxable || v.tracksStock !== r.tracksStock || (v.billingPeriod ?? null) !== r.billingPeriod || v.name !== r.variantName) changes.push("option details");
      action = changes.length ? "update" : "unchanged";
    } else {
      action = productsByName.has(r.productName.toLowerCase()) ? "add_option" : "create_product";
      changes.push(action === "add_option" ? `new option on "${r.productName}"` : "new product");
    }
    out.push({ line: r.line, sku: r.sku, action: errs.length ? "error" : action, changes, errors: errs, parsed: r, existing, categoryId: cat?.id ?? null });
  }
  return { rows: out.sort((a, b) => a.line - b.line), productsByName };
}

export async function previewProductImport(db: DB, actor: Actor, text: string) {
  authorize(actor, "catalogue.write");
  const { rows } = await plan(db, text);
  return rows.map(({ line, sku, action, changes, errors }) => ({ line, sku, action, changes, errors }));
}

/**
 * Applies the import. Rows with errors are skipped; price changes go through the same rules as manual
 * edits (sensitive changes become approval requests). Re-validates everything — never trusts the preview.
 */
export async function applyProductImport(db: DB, actor: Actor, text: string) {
  authorize(actor, "catalogue.write");
  const { rows, productsByName } = await plan(db, text);
  const result = { created: 0, updated: 0, unchanged: 0, approvals: 0, skipped: 0 };
  for (const r of rows) {
    const p = r.parsed;
    if (r.action === "error" || !p) {
      result.skipped++;
      continue;
    }
    if (r.action === "unchanged") {
      result.unchanged++;
      continue;
    }
    const variantFields = { sku: p.sku, name: p.variantName, priceMinor: p.priceMinor, currency: "GHS", taxable: p.taxable, tracksStock: p.tracksStock, billingPeriod: p.billingPeriod, warrantyMonths: p.warrantyMonths };
    if (r.action === "create_product") {
      const { product } = await createProduct(db, actor, { name: p.productName, summary: p.summary, description: p.summary, type: p.type, categoryId: r.categoryId, status: p.status }, variantFields);
      productsByName.set(p.productName.toLowerCase(), product);
      result.created++;
    } else if (r.action === "add_option") {
      const product = productsByName.get(p.productName.toLowerCase())!;
      await addVariant(db, actor, product.id, variantFields);
      result.created++;
    } else {
      const { v, p: prod } = r.existing!;
      await updateProduct(db, actor, prod.id, { name: p.productName, summary: p.summary, description: prod.description ?? p.summary, type: prod.type, categoryId: p.categorySlug ? r.categoryId : prod.categoryId, status: p.status });
      await db
        .update(productVariants)
        .set({ name: p.variantName, taxable: p.taxable, tracksStock: p.tracksStock, billingPeriod: p.billingPeriod, warrantyMonths: p.warrantyMonths })
        .where(eq(productVariants.id, v.id));
      if (v.priceMinor !== p.priceMinor) {
        const pc = await requestPriceChange(db, actor, v.id, p.priceMinor, "CSV import").catch(() => null);
        if (pc && !pc.applied) result.approvals++;
      }
      result.updated++;
    }
  }
  await audit(db, { actor, action: "catalogue.imported", targetType: "catalogue", data: result });
  return result;
}
