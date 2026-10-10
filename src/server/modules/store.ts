import { inArray, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { orderLines, orders, products, productVariants } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, invalid } from "../lib/errors";
import { computeTotals, formatMoney } from "../lib/money";
import { enforce } from "../auth/rate-limit";
import { audit } from "./audit";
import { publish } from "./events";
import { computeAvailability, levelsForVariants, reserveForOrder, type Availability } from "./inventory";
import { issueInvoiceForOrder } from "./invoices";
import { announce, notifyPermission } from "./notifications";
import { createEnquiry } from "./sales";
import { activeTaxes, getSettings, nextNumber } from "./settings";

/**
 * Online store: a cart kept in a cookie (variant ids and quantities only — never prices) and checkout for
 * signed-in customer organisations. Everything is re-priced and re-checked against the database at checkout.
 */
export const MAX_CART_LINES = 30;
export const MAX_LINE_QTY = 999;

export const cartSchema = z
  .array(z.object({ v: z.string().uuid(), q: z.number().int().min(1).max(MAX_LINE_QTY) }))
  .max(MAX_CART_LINES);
export type Cart = z.infer<typeof cartSchema>;

/** Never throws: a damaged or tampered cookie is treated as an empty cart. */
export function parseCart(raw: string | undefined | null): Cart {
  if (!raw) return [];
  try {
    const parsed = cartSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    const merged = new Map<string, number>();
    for (const l of parsed.data) merged.set(l.v, Math.min(MAX_LINE_QTY, (merged.get(l.v) ?? 0) + l.q));
    return [...merged].map(([v, q]) => ({ v, q }));
  } catch {
    return [];
  }
}

export function setCartLine(cart: Cart, variantId: string, quantity: number, mode: "add" | "set"): Cart {
  if (!z.string().uuid().safeParse(variantId).success) throw invalid("Unknown product option.");
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_LINE_QTY) throw invalid(`Enter a quantity from 1 to ${MAX_LINE_QTY}.`);
  const existing = cart.find((l) => l.v === variantId);
  const q = Math.min(MAX_LINE_QTY, mode === "add" ? (existing?.q ?? 0) + quantity : quantity);
  if (q === 0) return cart.filter((l) => l.v !== variantId);
  if (existing) return cart.map((l) => (l.v === variantId ? { v: l.v, q } : l));
  if (cart.length >= MAX_CART_LINES) throw invalid(`A cart can hold up to ${MAX_CART_LINES} different items. Request a quotation for larger orders.`);
  return [...cart, { v: variantId, q }];
}

export const cartCount = (cart: Cart) => cart.reduce((a, l) => a + l.q, 0);

export interface PricedLine {
  variantId: string;
  sku: string;
  slug: string;
  productName: string;
  variantName: string;
  billingPeriod: string | null;
  quantity: number;
  unitPriceMinor: number;
  taxable: boolean;
  tracksStock: boolean;
  lineTotalMinor: number;
  availability: Availability;
  problem: string | null;
}

/** Current prices, taxes and stock for a cart. Lines that cannot be bought carry a `problem`. */
export async function priceCart(db: DB, cart: Cart, now = new Date()) {
  const s = await getSettings(db);
  const ids = cart.map((l) => l.v);
  const rows = ids.length
    ? await db
        .select({ v: productVariants, productName: products.name, slug: products.slug, productStatus: products.status })
        .from(productVariants)
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(inArray(productVariants.id, ids))
    : [];
  const levels = await levelsForVariants(db, rows.map((r) => r.v.id));
  const lines: PricedLine[] = [];
  for (const item of cart) {
    const r = rows.find((x) => x.v.id === item.v);
    if (!r) continue; // removed from the catalogue: silently dropped
    const availability = computeAvailability(levels.filter((l) => l.variantId === r.v.id), r.v.tracksStock, now);
    let problem: string | null = null;
    if (!r.v.active || r.productStatus !== "active") problem = "No longer available.";
    else if (r.v.currency !== s.defaultCurrency) problem = `Priced in ${r.v.currency}; request a quotation.`;
    else if (r.v.tracksStock && availability.available < item.q) {
      problem = availability.available === 0 ? (availability.stale ? "Stock not confirmed — request a quotation." : "Out of stock.") : `Only ${availability.available} available.`;
    }
    lines.push({
      variantId: r.v.id,
      sku: r.v.sku,
      slug: r.slug,
      productName: r.productName,
      variantName: r.v.name,
      billingPeriod: r.v.billingPeriod,
      quantity: item.q,
      unitPriceMinor: r.v.priceMinor,
      taxable: r.v.taxable,
      tracksStock: r.v.tracksStock,
      lineTotalMinor: r.v.priceMinor * item.q,
      availability,
      problem,
    });
  }
  const taxes = await activeTaxes(db);
  const totals = computeTotals({ lines, discountBp: 0, taxes });
  const overLimit = totals.totalMinor >= s.storeOrderLimitMinor;
  return { lines, totals, currency: s.defaultCurrency, limitMinor: s.storeOrderLimitMinor, overLimit, ok: lines.length > 0 && !overLimit && lines.every((l) => !l.problem) };
}

export const checkoutInput = z.object({
  cart: cartSchema.min(1, "Your cart is empty."),
  customerReference: z.string().trim().max(60).optional().default(""),
});

/** Places an order from the cart: re-prices, reserves stock and issues the invoice in one transaction. */
export async function placeStoreOrder(db: DB, actor: Actor, input: z.input<typeof checkoutInput>, now = new Date()) {
  if (actor.organizationType !== "customer") throw conflict("Store orders are placed from a customer account. Staff should use quotations.");
  authorize(actor, "customer.orders.place", { organizationId: actor.organizationId });
  const data = checkoutInput.parse(input);
  await enforce(db, `checkout:user:${actor.userId}`, 10, 60 * 60);
  const s = await getSettings(db);
  const priced = await priceCart(db, data.cart, now);
  if (priced.lines.length === 0) throw invalid("Your cart is empty.");
  const problems = priced.lines.filter((l) => l.problem).map((l) => `${l.productName} — ${l.variantName}: ${l.problem}`);
  if (problems.length) throw conflict(`Please update your cart:\n${problems.join("\n")}`);
  if (priced.overLimit) {
    throw conflict(`Orders of ${formatMoney(priced.limitMinor, priced.currency)} or more go through a quotation so we can confirm supply and terms. Use “Request a quotation”.`);
  }

  const order = await db.transaction(async (tx) => {
    const [o] = await tx
      .insert(orders)
      .values({
        number: await nextNumber(tx, "O", now),
        customerOrgId: actor.organizationId,
        source: "store",
        customerReference: data.customerReference || null,
        status: "pending",
        currency: priced.currency,
        subtotalMinor: priced.totals.subtotalMinor,
        discountMinor: 0,
        taxMinor: priced.totals.taxMinor,
        totalMinor: priced.totals.totalMinor,
        taxBreakdown: priced.totals.breakdown,
        createdBy: actor.userId,
      })
      .returning();
    // Stock is checked again here under row locks; the cart view above can be out of date.
    const allocations = await reserveForOrder(
      tx,
      o!.id,
      priced.lines.filter((l) => l.tracksStock).map((l) => ({ variantId: l.variantId, quantity: l.quantity, sku: l.sku })),
      new Date(now.getTime() + s.reservationHoldHours * 3_600_000),
      now,
    );
    await tx.insert(orderLines).values(
      priced.lines.map((l, i) => ({
        orderId: o!.id,
        variantId: l.variantId,
        description: `${l.productName} — ${l.variantName} (${l.sku})`,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
        taxable: l.taxable,
        lineTotalMinor: priced.totals.lineTotals[i]!,
        fulfilmentConnectionId: allocations.find((a) => a.variantId === l.variantId && a.connectionId)?.connectionId ?? null,
      })),
    );
    const invoice = await issueInvoiceForOrder(tx, o!.id, { actor, now });
    await audit(tx, { actor, action: "order.placed", targetType: "order", targetId: o!.id, data: { number: o!.number, source: "store", totalMinor: o!.totalMinor, invoice: invoice.number } });
    await notifyPermission(tx, "orders.write", { title: `New store order ${o!.number}`, body: `${formatMoney(o!.totalMinor, o!.currency)} — confirm it once payment or terms are in place.`, link: `/ops/orders/${o!.id}` });
    return { ...o!, invoiceId: invoice.id };
  });
  publish({ topic: "orders", orgIds: [order.customerOrgId] });
  publish({ topic: "invoices", orgIds: [order.customerOrgId] });
  publish({ topic: "stock" });
  announce();
  return order;
}

export const cartQuoteInput = z.object({
  contactName: z.string(),
  email: z.string(),
  phone: z.string().optional().default(""),
  companyName: z.string().optional().default(""),
  message: z.string().trim().max(2000).optional().default(""),
  website: z.string().optional().default(""),
});

/** Turns a cart into a quotation request (a lead), for visitors and for orders above the store limit. */
export async function requestCartQuote(db: DB, input: z.input<typeof cartQuoteInput>, cart: Cart, ip: string | null) {
  const data = cartQuoteInput.parse(input);
  const priced = await priceCart(db, cart);
  if (priced.lines.length === 0) throw invalid("Your cart is empty.");
  const items = priced.lines.map((l) => `- ${l.quantity} × ${l.productName} — ${l.variantName} (${l.sku}) at ${formatMoney(l.unitPriceMinor, priced.currency)}`).join("\n");
  return createEnquiry(
    db,
    {
      ...data,
      serviceInterest: "Store / products",
      message: `Quotation requested for this cart:\n${items}${data.message ? `\n\nNotes: ${data.message}` : ""}`.slice(0, 4000),
    },
    ip,
  );
}
