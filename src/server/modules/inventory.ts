import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import {
  categories,
  integrationConnections,
  orders,
  organizations,
  products,
  productVariants,
  stockCountLines,
  stockCounts,
  stockLevels,
  stockLocations,
  stockMovements,
  stockReservations,
  stockSerials,
  stockTransferLines,
  stockTransfers,
  users,
} from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, invalid, notFound } from "../lib/errors";
import { audit } from "./audit";
import { publish } from "./events";
import { settleInvoicesForClosedOrder } from "./invoices";
import { nextNumber, operatorOrgId } from "./settings";
import { notifyPermission } from "./notifications";

/**
 * Stock. Two kinds of location:
 * - SES-managed (warehouses, shop, vans …): received, adjusted, transferred and counted here, valued at average cost.
 * - Partner locations (connectionId set): fed by the partner's events only, never edited by hand; their stock is
 *   offered for sale only while fresh (see staleness).
 */

// ───────────────────────────── Availability ─────────────────────────────

export type AvailabilityStatus = "in_stock" | "low_stock" | "out_of_stock" | "unconfirmed" | "not_tracked";

export interface LevelForAvailability {
  onHand: number;
  reserved: number;
  sourceUpdatedAt: Date;
  /** null for SES-managed stock (never stale) */
  staleAfterSeconds: number | null;
  /** SES-managed stock at a location that is closed or not for sale is ignored. */
  sellable?: boolean;
}

export interface Availability {
  status: AvailabilityStatus;
  available: number;
  /** Latest partner sync time, if any stock comes from a partner. */
  lastSyncAt: Date | null;
  stale: boolean;
  purchasable: boolean;
}

export const LOW_STOCK_AT = 3;

export const isFresh = (l: LevelForAvailability, now: Date) =>
  l.staleAfterSeconds === null || now.getTime() - l.sourceUpdatedAt.getTime() <= l.staleAfterSeconds * 1000;

export function computeAvailability(all: LevelForAvailability[], tracksStock: boolean, now = new Date(), lowAt = LOW_STOCK_AT): Availability {
  const levels = all.filter((l) => l.sellable !== false);
  const partnerLevels = levels.filter((l) => l.staleAfterSeconds !== null);
  const lastSyncAt = partnerLevels.length ? new Date(Math.max(...partnerLevels.map((l) => l.sourceUpdatedAt.getTime()))) : null;
  if (!tracksStock) return { status: "not_tracked", available: 0, lastSyncAt, stale: false, purchasable: true };
  const fresh = levels.filter((l) => isFresh(l, now));
  const stale = fresh.length < levels.length;
  const available = fresh.reduce((sum, l) => sum + Math.max(0, l.onHand - l.reserved), 0);
  let status: AvailabilityStatus;
  if (available === 0 && stale) status = "unconfirmed";
  else if (available === 0) status = "out_of_stock";
  else if (available <= lowAt) status = "low_stock";
  else status = "in_stock";
  return { status, available, lastSyncAt, stale, purchasable: available > 0 };
}

/** Stock rows for variants, with the staleness window of the supplying connection and sellability. */
export async function levelsForVariants(db: DB, variantIds: string[]) {
  if (variantIds.length === 0) return [];
  return db
    .select({
      id: stockLevels.id,
      variantId: stockLevels.variantId,
      locationId: stockLevels.locationId,
      locationName: stockLocations.name,
      locationCode: stockLocations.code,
      connectionId: stockLocations.connectionId,
      sellable: sql<boolean>`(${stockLocations.connectionId} IS NOT NULL) OR (${stockLocations.sellable} AND ${stockLocations.active})`,
      onHand: stockLevels.onHand,
      reserved: stockLevels.reserved,
      sourceUpdatedAt: stockLevels.sourceUpdatedAt,
      staleAfterSeconds: integrationConnections.staleAfterSeconds,
    })
    .from(stockLevels)
    .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
    .leftJoin(integrationConnections, eq(integrationConnections.id, stockLocations.connectionId))
    .where(inArray(stockLevels.variantId, variantIds))
    .orderBy(asc(stockLocations.code));
}

// ───────────────────────────── Locations ─────────────────────────────

export const LOCATION_KINDS = { warehouse: "Warehouse / store room", shop: "Shop / counter", van: "Vehicle", other: "Other" } as const;

export async function listLocations(db: DB, opts: { managedOnly?: boolean; activeOnly?: boolean } = {}) {
  const conds: SQL[] = [];
  if (opts.managedOnly) conds.push(isNull(stockLocations.connectionId));
  if (opts.activeOnly) conds.push(eq(stockLocations.active, true));
  return db
    .select()
    .from(stockLocations)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`${stockLocations.connectionId} IS NOT NULL`, desc(stockLocations.isDefault), asc(stockLocations.code));
}

export async function defaultLocationId(db: DB) {
  const [loc] = await db
    .select({ id: stockLocations.id })
    .from(stockLocations)
    .where(and(isNull(stockLocations.connectionId), eq(stockLocations.active, true)))
    .orderBy(desc(stockLocations.isDefault), asc(stockLocations.code))
    .limit(1);
  if (!loc) throw new Error("No SES stock location — run the seed.");
  return loc.id;
}

export const locationInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,16}$/, "Code: 2–16 capital letters, digits or dashes."),
  name: z.string().trim().min(2).max(80),
  kind: z.enum(["warehouse", "shop", "van", "other"]),
  sellable: z.boolean(),
  isDefault: z.boolean(),
  active: z.boolean(),
  address: z.string().trim().max(300).optional().default(""),
});

export async function saveLocation(db: DB, actor: Actor, id: string | null, input: z.input<typeof locationInput>) {
  authorize(actor, "settings.manage");
  const d = locationInput.parse(input);
  if (d.isDefault && !d.active) throw invalid("The default location must be active.");
  const row = await db.transaction(async (tx) => {
    if (id) {
      const [cur] = await tx.select().from(stockLocations).where(eq(stockLocations.id, id));
      if (!cur) throw notFound("Location not found.");
      if (cur.connectionId) throw invalid("Partner locations are managed by the partner connection.");
    }
    const [clash] = await tx.select({ id: stockLocations.id }).from(stockLocations).where(eq(stockLocations.code, d.code));
    if (clash && clash.id !== id) throw conflict(`Code ${d.code} is already used.`);
    if (id && !d.active) {
      const [held] = await tx.select({ n: sql<number>`count(*)::int` }).from(stockLevels).where(and(eq(stockLevels.locationId, id), sql`${stockLevels.onHand} > 0`));
      if (held!.n > 0) throw conflict("Move or count out the stock here before closing this location.");
    }
    if (d.isDefault) await tx.update(stockLocations).set({ isDefault: false }).where(eq(stockLocations.isDefault, true));
    const values = { ...d, address: d.address || null };
    const [r] = id
      ? await tx.update(stockLocations).set(values).where(eq(stockLocations.id, id)).returning()
      : await tx.insert(stockLocations).values({ ...values, organizationId: await operatorOrgId(tx) }).returning();
    const [anyDefault] = await tx.select({ id: stockLocations.id }).from(stockLocations).where(eq(stockLocations.isDefault, true));
    if (!anyDefault) throw invalid("Keep one default location.");
    await audit(tx, { actor, action: id ? "location.updated" : "location.created", targetType: "stock_location", targetId: r!.id, data: values });
    return r!;
  });
  publish({ topic: "stock" });
  return row;
}

// ───────────────────────────── Movements & levels ─────────────────────────────

export const MOVEMENT_LABELS: Record<string, string> = {
  receipt: "Received",
  fulfilment: "Sold / fulfilled",
  return: "Customer return",
  transfer_out: "Transferred out",
  transfer_in: "Transferred in",
  count: "Stocktake",
  damaged: "Damaged",
  lost: "Lost or stolen",
  expired: "Expired / obsolete",
  internal_use: "Used internally",
  supplier_return: "Returned to supplier",
  found: "Found",
  correction: "Correction",
  adjustment: "Adjustment",
};
export const ADJUST_REASONS = {
  damaged: "decrease",
  lost: "decrease",
  expired: "decrease",
  internal_use: "decrease",
  supplier_return: "decrease",
  found: "increase",
  correction: "either",
} as const;
export type AdjustReason = keyof typeof ADJUST_REASONS;

export interface MovementInput {
  variantId: string;
  locationId: string;
  quantity: number;
  reason: string;
  refType?: string;
  refId?: string;
  note?: string;
  actorUserId?: string | null;
  /** Defaults to the item's current average cost. */
  unitCostMinor?: number | null;
}

/** Appends to the stock ledger (SES-managed locations only). Call inside the same transaction as the change. */
export async function recordMovement(tx: DB, m: MovementInput) {
  if (m.quantity === 0) return;
  let unitCostMinor = m.unitCostMinor;
  if (unitCostMinor === undefined) {
    const [v] = await tx.select({ cost: productVariants.costMinor }).from(productVariants).where(eq(productVariants.id, m.variantId));
    unitCostMinor = v?.cost ?? null;
  }
  await tx.insert(stockMovements).values({ ...m, unitCostMinor, refType: m.refType ?? null, refId: m.refId ?? null, note: m.note ?? null, actorUserId: m.actorUserId ?? null });
}

async function managedLocation(tx: DB, locationId: string) {
  const [l] = await tx.select().from(stockLocations).where(eq(stockLocations.id, locationId));
  if (!l) throw notFound("Unknown location.");
  if (l.connectionId) throw invalid("Partner stock is updated by the partner feed, not manually.");
  if (!l.active) throw invalid("Choose an open location.");
  return l;
}

/** Changes on-hand at one SES-managed location under a row lock. Never below zero or below what is reserved there. */
async function bump(tx: DB, variantId: string, locationId: string, delta: number, label: string) {
  const [level] = await tx.select().from(stockLevels).where(and(eq(stockLevels.variantId, variantId), eq(stockLevels.locationId, locationId))).for("update");
  const before = level?.onHand ?? 0;
  const after = before + delta;
  if (after < 0) throw conflict(`${label}: only ${before} on hand at that location.`);
  if (level && after < level.reserved) throw conflict(`${label}: cannot go below the ${level.reserved} reserved there. Release or fulfil those orders first.`);
  if (level) await tx.update(stockLevels).set({ onHand: after, sourceUpdatedAt: new Date() }).where(eq(stockLevels.id, level.id));
  else await tx.insert(stockLevels).values({ variantId, locationId, onHand: after });
  return { before, after };
}

async function trackedVariant(tx: DB, variantId: string) {
  const [v] = await tx.select({ v: productVariants, productName: products.name }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId)).where(eq(productVariants.id, variantId));
  if (!v) throw notFound("Unknown variant.");
  if (!v.v.tracksStock) throw invalid(`${v.v.sku} does not track stock.`);
  return { ...v.v, label: `${v.productName} (${v.v.sku})` };
}

export function parseSerials(text: string | string[] | undefined) {
  const raw = Array.isArray(text) ? text : (text ?? "").split(/[\s,;]+/);
  const out = [...new Set(raw.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  for (const s of out) if (!/^[A-Z0-9][A-Z0-9._/-]{0,59}$/.test(s)) throw invalid(`"${s.slice(0, 30)}" is not a valid serial number.`);
  return out;
}

function requireSerialCount(v: { serialTracked: boolean; sku: string }, serials: string[], qty: number) {
  if (!v.serialTracked) {
    if (serials.length) throw invalid(`${v.sku} does not use serial numbers.`);
    return;
  }
  if (serials.length !== qty) throw invalid(`${v.sku} needs one serial number per unit: ${qty} expected, ${serials.length} given.`);
}

async function setSerials(tx: DB, variantId: string, serials: string[], expect: { status: string; locationId?: string | null }, next: Partial<typeof stockSerials.$inferInsert>) {
  if (serials.length === 0) return;
  const rows = await tx.select().from(stockSerials).where(and(eq(stockSerials.variantId, variantId), inArray(stockSerials.serial, serials))).for("update");
  for (const s of serials) {
    const r = rows.find((x) => x.serial === s);
    if (!r || r.status !== expect.status || (expect.locationId !== undefined && r.locationId !== expect.locationId)) throw conflict(`Serial ${s} is not ${expect.status.replace("_", " ")}${expect.locationId ? " at that location" : ""}.`);
  }
  await tx.update(stockSerials).set(next).where(and(eq(stockSerials.variantId, variantId), inArray(stockSerials.serial, serials)));
}

/** Weighted average cost over SES-managed stock after receiving `qty` at `unitCostMinor`. */
async function applyReceiptCost(tx: DB, v: { id: string; costMinor: number | null }, qty: number, unitCostMinor: number | null | undefined) {
  if (unitCostMinor === null || unitCostMinor === undefined) return;
  const [tot] = await tx
    .select({ n: sql<number>`coalesce(sum(${stockLevels.onHand}), 0)::int` })
    .from(stockLevels)
    .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
    .where(and(eq(stockLevels.variantId, v.id), isNull(stockLocations.connectionId)));
  const onHand = Math.max(0, tot!.n);
  const next = v.costMinor === null || onHand === 0 ? unitCostMinor : Math.round((onHand * v.costMinor + qty * unitCostMinor) / (onHand + qty));
  if (next !== v.costMinor) await tx.update(productVariants).set({ costMinor: next }).where(eq(productVariants.id, v.id));
}

export const receiveInput = z.object({
  variantId: z.string().uuid(),
  locationId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().min(1).max(1_000_000),
  unitCostMinor: z.number().int().min(0).nullable().optional(),
  serials: z.union([z.string(), z.array(z.string())]).optional(),
  note: z.string().trim().max(300).optional().default(""),
});

/** Adds delivered stock (inside the caller's transaction); updates the average cost when a unit cost is given. */
export async function receiveStockTx(tx: DB, actor: Actor | null, input: z.input<typeof receiveInput>, ref?: { type: string; id: string }) {
  const d = receiveInput.parse(input);
  const v = await trackedVariant(tx, d.variantId);
  const locationId = d.locationId ?? (await defaultLocationId(tx));
  await managedLocation(tx, locationId);
  const serials = parseSerials(d.serials);
  requireSerialCount(v, serials, d.quantity);
  await applyReceiptCost(tx, v, d.quantity, d.unitCostMinor);
  const { before, after } = await bump(tx, v.id, locationId, d.quantity, v.label);
  if (serials.length) {
    const taken = await tx.select({ serial: stockSerials.serial, status: stockSerials.status }).from(stockSerials).where(and(eq(stockSerials.variantId, v.id), inArray(stockSerials.serial, serials)));
    const clash = taken.find((t) => t.status === "in_stock" || t.status === "in_transit");
    if (clash) throw conflict(`Serial ${clash.serial} is already in stock.`);
    for (const s of serials) {
      await tx
        .insert(stockSerials)
        .values({ variantId: v.id, serial: s, status: "in_stock", locationId, receivedAt: new Date() })
        .onConflictDoUpdate({ target: [stockSerials.variantId, stockSerials.serial], set: { status: "in_stock", locationId, orderId: null, soldAt: null, receivedAt: new Date() } });
    }
  }
  await recordMovement(tx, { variantId: v.id, locationId, quantity: d.quantity, reason: "receipt", refType: ref?.type, refId: ref?.id, note: d.note || undefined, actorUserId: actor?.userId, unitCostMinor: d.unitCostMinor ?? v.costMinor });
  await audit(tx, { actor, action: "stock.received", targetType: "variant", targetId: v.id, data: { sku: v.sku, locationId, from: before, to: after, unitCostMinor: d.unitCostMinor ?? null, serials, ref } });
}

export async function receiveStock(db: DB, actor: Actor, input: z.input<typeof receiveInput>) {
  authorize(actor, "inventory.adjust");
  await db.transaction((tx) => receiveStockTx(tx, actor, input));
  publish({ topic: "stock", data: { variantId: input.variantId } });
}

export const adjustInput = z.object({
  variantId: z.string().uuid(),
  locationId: z.string().uuid(),
  reason: z.enum(Object.keys(ADJUST_REASONS) as [AdjustReason, ...AdjustReason[]]),
  quantity: z.number().int().min(-1_000_000).max(1_000_000),
  note: z.string().trim().max(300),
  serials: z.union([z.string(), z.array(z.string())]).optional(),
});

/** Damage, loss, internal use, returns to supplier, found stock or a correction, with a reason. */
export async function recordAdjustment(db: DB, actor: Actor, input: z.input<typeof adjustInput>) {
  authorize(actor, "inventory.adjust");
  const d = adjustInput.parse(input);
  const dir = ADJUST_REASONS[d.reason];
  if (d.quantity === 0) throw invalid("Enter how many units.");
  if (dir !== "either" && d.quantity < 0) throw invalid("Enter a positive number of units.");
  if (d.note.length < 3) throw invalid("Say what happened (at least a few words).");
  const delta = dir === "decrease" ? -d.quantity : d.quantity;
  await db.transaction(async (tx) => {
    const v = await trackedVariant(tx, d.variantId);
    await managedLocation(tx, d.locationId);
    const serials = parseSerials(d.serials);
    requireSerialCount(v, serials, Math.abs(delta));
    const { before, after } = await bump(tx, v.id, d.locationId, delta, v.label);
    const note = `${MOVEMENT_LABELS[d.reason]}: ${d.note}`.slice(0, 300);
    if (delta < 0) {
      await setSerials(tx, v.id, serials, { status: "in_stock", locationId: d.locationId }, { status: d.reason === "supplier_return" ? "returned_to_supplier" : "written_off", locationId: null, note });
    } else {
      for (const s of serials) {
        await tx.insert(stockSerials).values({ variantId: v.id, serial: s, status: "in_stock", locationId: d.locationId, note }).onConflictDoUpdate({ target: [stockSerials.variantId, stockSerials.serial], set: { status: "in_stock", locationId: d.locationId, note } });
      }
    }
    await recordMovement(tx, { variantId: v.id, locationId: d.locationId, quantity: delta, reason: d.reason, note: d.note, actorUserId: actor.userId });
    await audit(tx, { actor, action: "stock.adjusted", targetType: "variant", targetId: v.id, data: { sku: v.sku, reason: d.reason, locationId: d.locationId, from: before, to: after, note: d.note, serials } });
  });
  publish({ topic: "stock", data: { variantId: input.variantId } });
}

/** Sets a counted quantity at one SES-managed location. Partner stock is owned by the partner feed. */
export async function adjustStock(db: DB, actor: Actor, input: { variantId: string; locationId: string; onHand: number; reason: string }) {
  authorize(actor, "inventory.adjust");
  if (!Number.isInteger(input.onHand) || input.onHand < 0) throw invalid("Quantity must be a whole number of 0 or more.");
  if (input.reason.trim().length < 3) throw invalid("Give a reason for the adjustment.");
  await db.transaction(async (tx) => {
    const loc = await managedLocation(tx, input.locationId);
    const v = await trackedVariant(tx, input.variantId);
    const [existing] = await tx.select().from(stockLevels).where(and(eq(stockLevels.variantId, v.id), eq(stockLevels.locationId, loc.id)));
    const delta = input.onHand - (existing?.onHand ?? 0);
    const { before, after } = await bump(tx, v.id, loc.id, delta, v.label);
    await recordMovement(tx, { variantId: v.id, locationId: loc.id, quantity: delta, reason: "count", note: input.reason.trim(), actorUserId: actor.userId });
    await audit(tx, { actor, action: "stock.adjusted", targetType: "variant", targetId: v.id, data: { location: loc.code, from: before, to: after, reason: input.reason } });
  });
  publish({ topic: "stock", data: { variantId: input.variantId } });
}
export const countStock = adjustStock;

// ───────────────────────────── Orders: reservations ─────────────────────────────

/**
 * Reserve stock for an order inside the caller's transaction.
 * Rows are locked (SELECT … FOR UPDATE) so concurrent checkouts cannot oversell.
 * SES stock (sellable, open locations; default first) is used before partner stock; stale partner stock is never reserved.
 */
export async function reserveForOrder(tx: DB, orderId: string, lines: { variantId: string; quantity: number; sku: string }[], expiresAt: Date | null, now = new Date()) {
  const allocations: { variantId: string; connectionId: string | null; quantity: number }[] = [];
  for (const line of lines) {
    const rows = await tx
      .select({ level: stockLevels, connectionId: stockLocations.connectionId, staleAfterSeconds: integrationConnections.staleAfterSeconds })
      .from(stockLevels)
      .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
      .leftJoin(integrationConnections, eq(integrationConnections.id, stockLocations.connectionId))
      .where(and(eq(stockLevels.variantId, line.variantId), or(isNotNull(stockLocations.connectionId), and(eq(stockLocations.sellable, true), eq(stockLocations.active, true)))))
      .orderBy(sql`${stockLocations.connectionId} IS NOT NULL`, desc(stockLocations.isDefault), asc(stockLocations.code))
      .for("update", { of: stockLevels });
    let remaining = line.quantity;
    for (const r of rows) {
      if (remaining === 0) break;
      if (!isFresh({ ...r.level, staleAfterSeconds: r.staleAfterSeconds }, now)) continue;
      const take = Math.min(remaining, r.level.onHand - r.level.reserved);
      if (take <= 0) continue;
      await tx.update(stockLevels).set({ reserved: sql`${stockLevels.reserved} + ${take}` }).where(eq(stockLevels.id, r.level.id));
      await tx.insert(stockReservations).values({ stockLevelId: r.level.id, variantId: line.variantId, orderId, quantity: take, expiresAt });
      allocations.push({ variantId: line.variantId, connectionId: r.connectionId, quantity: take });
      remaining -= take;
    }
    if (remaining > 0) throw conflict(`Not enough confirmed stock for ${line.sku}: ${line.quantity - remaining} of ${line.quantity} available.`);
  }
  return allocations;
}

/** Serial-tracked items held at SES locations that an order needs serial numbers for when it is fulfilled. */
export async function serialsNeeded(db: DB, orderId: string) {
  return db
    .select({ variantId: stockReservations.variantId, sku: productVariants.sku, name: products.name, locationId: stockLevels.locationId, quantity: sql<number>`sum(${stockReservations.quantity})::int` })
    .from(stockReservations)
    .innerJoin(productVariants, eq(productVariants.id, stockReservations.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(stockLevels, eq(stockLevels.id, stockReservations.stockLevelId))
    .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active"), eq(productVariants.serialTracked, true), isNull(stockLocations.connectionId)))
    .groupBy(stockReservations.variantId, productVariants.sku, products.name, stockLevels.locationId);
}

async function settleReservations(tx: DB, orderId: string, mode: "release" | "consume", serialsByVariant: Record<string, string[]> = {}) {
  const active = await tx.select().from(stockReservations).where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
  const used = new Map<string, string[]>();
  for (const r of active) {
    await tx
      .update(stockLevels)
      .set(mode === "consume" ? { reserved: sql`${stockLevels.reserved} - ${r.quantity}`, onHand: sql`GREATEST(${stockLevels.onHand} - ${r.quantity}, 0)` } : { reserved: sql`GREATEST(${stockLevels.reserved} - ${r.quantity}, 0)` })
      .where(eq(stockLevels.id, r.stockLevelId));
    await tx.update(stockReservations).set({ status: mode === "consume" ? "consumed" : "released" }).where(eq(stockReservations.id, r.id));
    if (mode === "consume") {
      const [lvl] = await tx
        .select({ locationId: stockLevels.locationId, connectionId: stockLocations.connectionId })
        .from(stockLevels)
        .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
        .where(eq(stockLevels.id, r.stockLevelId));
      if (lvl && !lvl.connectionId) {
        const [v] = await tx.select().from(productVariants).where(eq(productVariants.id, r.variantId));
        if (v?.serialTracked) {
          const pool = serialsByVariant[r.variantId] ?? [];
          const done = used.get(r.variantId) ?? [];
          const take = pool.slice(done.length, done.length + r.quantity);
          if (take.length !== r.quantity) throw invalid(`Enter the serial numbers for ${v.sku} (${r.quantity} needed).`);
          await setSerials(tx, r.variantId, take, { status: "in_stock", locationId: lvl.locationId }, { status: "sold", locationId: null, orderId, soldAt: new Date() });
          used.set(r.variantId, [...done, ...take]);
        }
        await recordMovement(tx, { variantId: r.variantId, locationId: lvl.locationId, quantity: -r.quantity, reason: "fulfilment", refType: "order", refId: orderId });
      }
    }
  }
  for (const [variantId, given] of Object.entries(serialsByVariant)) {
    if (given.length > (used.get(variantId)?.length ?? 0)) throw invalid("More serial numbers were entered than units fulfilled from SES stock.");
  }
  return active.length;
}

export const releaseReservations = (tx: DB, orderId: string) => settleReservations(tx, orderId, "release");
export const consumeReservations = (tx: DB, orderId: string, serialsByVariant?: Record<string, string[]>) => settleReservations(tx, orderId, "consume", serialsByVariant);

export async function clearReservationExpiry(tx: DB, orderId: string) {
  await tx.update(stockReservations).set({ expiresAt: null }).where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
}

/** Job: release holds for orders that were never confirmed. */
export async function expireReservations(db: DB, now = new Date()) {
  const expired = await db.selectDistinct({ orderId: stockReservations.orderId }).from(stockReservations).where(and(eq(stockReservations.status, "active"), lt(stockReservations.expiresAt, now)));
  for (const { orderId } of expired) {
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!order || order.status !== "pending") return;
      await releaseReservations(tx, orderId);
      await tx.update(orders).set({ status: "expired" }).where(eq(orders.id, orderId));
      await settleInvoicesForClosedOrder(tx, orderId, "order expired: stock hold elapsed before confirmation");
      await audit(tx, { action: "order.expired", targetType: "order", targetId: orderId, data: { reason: "reservation hold elapsed" } });
    });
    publish({ topic: "orders" });
  }
  return expired.length;
}

// ───────────────────────────── Transfers ─────────────────────────────

export const transferInput = z.object({
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  note: z.string().trim().max(300).optional().default(""),
  lines: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(1_000_000), serials: z.union([z.string(), z.array(z.string())]).optional() })).min(1, "Add at least one item.").max(100),
});

export async function createTransfer(db: DB, actor: Actor, input: z.input<typeof transferInput>) {
  authorize(actor, "inventory.adjust");
  const d = transferInput.parse(input);
  if (d.fromLocationId === d.toLocationId) throw invalid("Choose two different locations.");
  const row = await db.transaction(async (tx) => {
    await managedLocation(tx, d.fromLocationId);
    await managedLocation(tx, d.toLocationId);
    const merged = new Map<string, { quantity: number; serials: string[] }>();
    for (const l of d.lines) {
      const cur = merged.get(l.variantId) ?? { quantity: 0, serials: [] };
      merged.set(l.variantId, { quantity: cur.quantity + l.quantity, serials: [...cur.serials, ...parseSerials(l.serials)] });
    }
    const [t] = await tx.insert(stockTransfers).values({ number: await nextNumber(tx, "TR"), fromLocationId: d.fromLocationId, toLocationId: d.toLocationId, note: d.note || null, createdBy: actor.userId }).returning();
    for (const [variantId, l] of merged) {
      const v = await trackedVariant(tx, variantId);
      if (l.serials.length) requireSerialCount(v, l.serials, l.quantity);
      await tx.insert(stockTransferLines).values({ transferId: t!.id, variantId, quantity: l.quantity, serials: l.serials });
    }
    await audit(tx, { actor, action: "transfer.created", targetType: "stock_transfer", targetId: t!.id, data: { ...d } });
    return t!;
  });
  publish({ topic: "stock" });
  return row;
}

async function lockTransfer(tx: DB, id: string) {
  const [t] = await tx.select().from(stockTransfers).where(eq(stockTransfers.id, id)).for("update");
  if (!t) throw notFound("Transfer not found.");
  return { t, lines: await tx.select().from(stockTransferLines).where(eq(stockTransferLines.transferId, id)) };
}

export async function dispatchTransfer(db: DB, actor: Actor, id: string, serialsByLine: Record<string, string> = {}) {
  authorize(actor, "inventory.adjust");
  await db.transaction(async (tx) => {
    const { t, lines } = await lockTransfer(tx, id);
    if (t.status !== "draft") throw conflict("Only draft transfers can be sent.");
    await managedLocation(tx, t.fromLocationId);
    for (const l of lines) {
      const v = await trackedVariant(tx, l.variantId);
      const serials = serialsByLine[l.id] ? parseSerials(serialsByLine[l.id]) : l.serials;
      requireSerialCount(v, serials, l.quantity);
      if (serials.length) await tx.update(stockTransferLines).set({ serials }).where(eq(stockTransferLines.id, l.id));
      await bump(tx, v.id, t.fromLocationId, -l.quantity, v.label);
      await setSerials(tx, v.id, serials, { status: "in_stock", locationId: t.fromLocationId }, { status: "in_transit", locationId: null });
      await recordMovement(tx, { variantId: v.id, locationId: t.fromLocationId, quantity: -l.quantity, reason: "transfer_out", refType: "transfer", refId: t.id, actorUserId: actor.userId });
    }
    await tx.update(stockTransfers).set({ status: "in_transit", dispatchedBy: actor.userId, dispatchedAt: new Date() }).where(eq(stockTransfers.id, id));
    await audit(tx, { actor, action: "transfer.dispatched", targetType: "stock_transfer", targetId: id });
  });
  publish({ topic: "stock" });
}

export async function receiveTransfer(db: DB, actor: Actor, id: string) {
  authorize(actor, "inventory.adjust");
  await db.transaction(async (tx) => {
    const { t, lines } = await lockTransfer(tx, id);
    if (t.status !== "in_transit") throw conflict("Only transfers on their way can be received.");
    await managedLocation(tx, t.toLocationId);
    for (const l of lines) {
      const v = await trackedVariant(tx, l.variantId);
      await bump(tx, v.id, t.toLocationId, l.quantity, v.label);
      await setSerials(tx, v.id, l.serials, { status: "in_transit" }, { status: "in_stock", locationId: t.toLocationId });
      await recordMovement(tx, { variantId: v.id, locationId: t.toLocationId, quantity: l.quantity, reason: "transfer_in", refType: "transfer", refId: t.id, actorUserId: actor.userId });
    }
    await tx.update(stockTransfers).set({ status: "received", receivedBy: actor.userId, receivedAt: new Date() }).where(eq(stockTransfers.id, id));
    await audit(tx, { actor, action: t.dispatchedBy === actor.userId ? "transfer.received_by_sender" : "transfer.received", targetType: "stock_transfer", targetId: id });
  });
  publish({ topic: "stock" });
}

export async function cancelTransfer(db: DB, actor: Actor, id: string, reason: string) {
  authorize(actor, "inventory.adjust");
  if (reason.trim().length < 3) throw invalid("Give a reason.");
  await db.transaction(async (tx) => {
    const { t, lines } = await lockTransfer(tx, id);
    if (!["draft", "in_transit"].includes(t.status)) throw conflict("This transfer is already closed.");
    if (t.status === "in_transit") {
      for (const l of lines) {
        const v = await trackedVariant(tx, l.variantId);
        await bump(tx, v.id, t.fromLocationId, l.quantity, v.label);
        await setSerials(tx, v.id, l.serials, { status: "in_transit" }, { status: "in_stock", locationId: t.fromLocationId });
        await recordMovement(tx, { variantId: v.id, locationId: t.fromLocationId, quantity: l.quantity, reason: "transfer_in", refType: "transfer", refId: t.id, note: `Cancelled: ${reason.trim()}`, actorUserId: actor.userId });
      }
    }
    await tx.update(stockTransfers).set({ status: "cancelled", note: [t.note, `Cancelled: ${reason.trim()}`].filter(Boolean).join("\n") }).where(eq(stockTransfers.id, id));
    await audit(tx, { actor, action: "transfer.cancelled", targetType: "stock_transfer", targetId: id, data: { reason } });
  });
  publish({ topic: "stock" });
}

export async function listTransfers(db: DB, actor: Actor) {
  authorize(actor, "inventory.read");
  const rows = await db.select().from(stockTransfers).orderBy(desc(stockTransfers.createdAt)).limit(200);
  const locs = new Map((await listLocations(db)).map((l) => [l.id, l.name]));
  const counts = rows.length
    ? await db.select({ id: stockTransferLines.transferId, units: sql<number>`sum(${stockTransferLines.quantity})::int` }).from(stockTransferLines).where(inArray(stockTransferLines.transferId, rows.map((r) => r.id))).groupBy(stockTransferLines.transferId)
    : [];
  return rows.map((r) => ({ ...r, fromName: locs.get(r.fromLocationId) ?? "?", toName: locs.get(r.toLocationId) ?? "?", units: counts.find((c) => c.id === r.id)?.units ?? 0 }));
}

export async function getTransfer(db: DB, actor: Actor, id: string) {
  authorize(actor, "inventory.read");
  const [t] = await db.select().from(stockTransfers).where(eq(stockTransfers.id, id));
  if (!t) throw notFound("Transfer not found.");
  const lines = await db
    .select({ line: stockTransferLines, sku: productVariants.sku, variantName: productVariants.name, productName: products.name, serialTracked: productVariants.serialTracked })
    .from(stockTransferLines)
    .innerJoin(productVariants, eq(productVariants.id, stockTransferLines.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(stockTransferLines.transferId, id))
    .orderBy(asc(productVariants.sku));
  const locs = new Map((await listLocations(db)).map((l) => [l.id, l.name]));
  const people = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, [t.createdBy, t.dispatchedBy, t.receivedBy].filter(Boolean) as string[]));
  const who = (uid: string | null) => people.find((p) => p.id === uid)?.name ?? null;
  return { ...t, fromName: locs.get(t.fromLocationId) ?? "?", toName: locs.get(t.toLocationId) ?? "?", createdByName: who(t.createdBy), dispatchedByName: who(t.dispatchedBy), receivedByName: who(t.receivedBy), lines };
}

// ───────────────────────────── Stocktakes ─────────────────────────────

export const countInput = z.object({
  locationId: z.string().uuid(),
  categoryId: z.string().uuid().nullable().optional(),
  blind: z.boolean().default(true),
  note: z.string().trim().max(300).optional().default(""),
});

export async function startCount(db: DB, actor: Actor, input: z.input<typeof countInput>) {
  authorize(actor, "inventory.adjust");
  const d = countInput.parse(input);
  const row = await db.transaction(async (tx) => {
    await managedLocation(tx, d.locationId);
    const [open] = await tx.select({ number: stockCounts.number }).from(stockCounts).where(and(eq(stockCounts.locationId, d.locationId), eq(stockCounts.status, "open")));
    if (open) throw conflict(`Stocktake ${open.number} is still open for this location.`);
    const conds: SQL[] = [eq(productVariants.tracksStock, true), eq(productVariants.active, true)];
    if (d.categoryId) {
      const kids = await tx.select({ id: categories.id }).from(categories).where(eq(categories.parentId, d.categoryId));
      conds.push(inArray(products.categoryId, [d.categoryId, ...kids.map((k) => k.id)]));
    } else conds.push(isNotNull(stockLevels.id));
    const items = await tx
      .select({ id: productVariants.id, cost: productVariants.costMinor, onHand: stockLevels.onHand })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(stockLevels, and(eq(stockLevels.variantId, productVariants.id), eq(stockLevels.locationId, d.locationId)))
      .where(and(...conds));
    const [c] = await tx.insert(stockCounts).values({ number: await nextNumber(tx, "SC"), locationId: d.locationId, categoryId: d.categoryId ?? null, blind: d.blind, note: d.note || null, createdBy: actor.userId }).returning();
    if (items.length) await tx.insert(stockCountLines).values(items.map((i) => ({ countId: c!.id, variantId: i.id, expected: i.onHand ?? 0, unitCostMinor: i.cost })));
    await audit(tx, { actor, action: "stocktake.started", targetType: "stock_count", targetId: c!.id, data: { ...d, lines: items.length } });
    return c!;
  });
  publish({ topic: "stock" });
  return row;
}

async function openCount(tx: DB, id: string) {
  const [c] = await tx.select().from(stockCounts).where(eq(stockCounts.id, id)).for("update");
  if (!c) throw notFound("Stocktake not found.");
  if (c.status !== "open") throw conflict("This stocktake is closed.");
  return c;
}

async function setLine(tx: DB, c: typeof stockCounts.$inferSelect, variantId: string, counted: number | null, mode: "set" | "add") {
  const v = await trackedVariant(tx, variantId);
  const [level] = await tx.select({ onHand: stockLevels.onHand }).from(stockLevels).where(and(eq(stockLevels.variantId, variantId), eq(stockLevels.locationId, c.locationId)));
  const system = level?.onHand ?? 0;
  const [line] = await tx.select().from(stockCountLines).where(and(eq(stockCountLines.countId, c.id), eq(stockCountLines.variantId, variantId)));
  const value = counted === null ? null : mode === "add" ? (line?.counted ?? 0) + counted : counted;
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 1_000_000)) throw invalid("Counts are whole numbers of 0 or more.");
  // Re-saving the sheet must not move the moment a line was counted.
  if (line && line.counted === value) return { sku: v.sku, label: v.label, counted: value };
  const stamp = value === null ? { systemAtCount: null, countedAt: null } : { systemAtCount: system, countedAt: new Date() };
  if (line) await tx.update(stockCountLines).set({ counted: value, ...stamp }).where(eq(stockCountLines.id, line.id));
  else await tx.insert(stockCountLines).values({ countId: c.id, variantId, expected: system, counted: value, unitCostMinor: v.costMinor, ...stamp });
  return { sku: v.sku, label: v.label, counted: value };
}

export async function recordCounts(db: DB, actor: Actor, id: string, entries: { variantId: string; counted: number | null }[]) {
  authorize(actor, "inventory.adjust");
  await db.transaction(async (tx) => {
    const c = await openCount(tx, id);
    for (const e of entries) await setLine(tx, c, e.variantId, e.counted, "set");
  });
}

export async function scanIntoCount(db: DB, actor: Actor, id: string, code: string, quantity = 1) {
  authorize(actor, "inventory.adjust");
  const v = await findVariantByCode(db, code);
  if (!v) throw notFound(`No item with code "${code.slice(0, 40)}".`);
  return db.transaction(async (tx) => setLine(tx, await openCount(tx, id), v.id, quantity, "add"));
}

/** Posts counted − system-at-count for every counted line; uncounted lines are left unchanged. */
export async function completeCount(db: DB, actor: Actor, id: string) {
  authorize(actor, "inventory.adjust");
  const result = await db.transaction(async (tx) => {
    const c = await openCount(tx, id);
    const lines = await tx.select().from(stockCountLines).where(and(eq(stockCountLines.countId, id), isNotNull(stockCountLines.counted)));
    if (lines.length === 0) throw invalid("Nothing has been counted yet.");
    let value = 0;
    let changed = 0;
    for (const l of lines) {
      const delta = l.counted! - (l.systemAtCount ?? l.expected);
      if (delta === 0) continue;
      const v = await trackedVariant(tx, l.variantId);
      await bump(tx, v.id, c.locationId, delta, v.label);
      await recordMovement(tx, { variantId: v.id, locationId: c.locationId, quantity: delta, reason: "count", refType: "stock_count", refId: c.id, note: `Stocktake ${c.number}`, actorUserId: actor.userId, unitCostMinor: l.unitCostMinor ?? v.costMinor });
      value += delta * (l.unitCostMinor ?? v.costMinor ?? 0);
      changed++;
    }
    await tx.update(stockCounts).set({ status: "completed", completedBy: actor.userId, completedAt: new Date(), varianceValueMinor: value }).where(eq(stockCounts.id, id));
    await audit(tx, { actor, action: "stocktake.completed", targetType: "stock_count", targetId: id, data: { counted: lines.length, changed, varianceValueMinor: value } });
    return { counted: lines.length, changed, varianceValueMinor: value };
  });
  publish({ topic: "stock" });
  return result;
}

export async function cancelCount(db: DB, actor: Actor, id: string) {
  authorize(actor, "inventory.adjust");
  await db.transaction(async (tx) => {
    await openCount(tx, id);
    await tx.update(stockCounts).set({ status: "cancelled" }).where(eq(stockCounts.id, id));
    await audit(tx, { actor, action: "stocktake.cancelled", targetType: "stock_count", targetId: id });
  });
}

export async function listCounts(db: DB, actor: Actor) {
  authorize(actor, "inventory.read");
  const rows = await db.select().from(stockCounts).orderBy(desc(stockCounts.createdAt)).limit(100);
  const locs = new Map((await listLocations(db)).map((l) => [l.id, l.name]));
  return rows.map((r) => ({ ...r, locationName: locs.get(r.locationId) ?? "?" }));
}

export async function getCount(db: DB, actor: Actor, id: string) {
  authorize(actor, "inventory.read");
  const [c] = await db.select().from(stockCounts).where(eq(stockCounts.id, id));
  if (!c) throw notFound("Stocktake not found.");
  const lines = await db
    .select({ line: stockCountLines, sku: productVariants.sku, barcode: productVariants.barcode, variantName: productVariants.name, productName: products.name })
    .from(stockCountLines)
    .innerJoin(productVariants, eq(productVariants.id, stockCountLines.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(stockCountLines.countId, id))
    .orderBy(asc(products.name), asc(productVariants.sku));
  const [loc] = await db.select().from(stockLocations).where(eq(stockLocations.id, c.locationId));
  return { ...c, locationName: loc?.name ?? "?", lines };
}

// ───────────────────────────── Look-ups & overviews ─────────────────────────────

export async function findVariantByCode(db: DB, code: string) {
  const c = code.trim();
  if (!c) return null;
  const [v] = await db.select().from(productVariants).where(or(eq(productVariants.sku, c.toUpperCase()), eq(productVariants.barcode, c))).limit(1);
  return v ?? null;
}

export async function itemOptions(db: DB) {
  const rows = await db
    .select({ sku: productVariants.sku, product: products.name, variant: productVariants.name })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(productVariants.tracksStock, true), eq(productVariants.active, true), sql`${products.status} <> 'retired'`))
    .orderBy(asc(products.name), asc(productVariants.sku))
    .limit(5000);
  return rows.map((r) => ({ sku: r.sku, name: r.variant === "Standard" ? r.product : `${r.product} — ${r.variant}` }));
}

export async function listMovements(db: DB, actor: Actor, variantId: string, limit = 25) {
  authorize(actor, "inventory.read");
  return db
    .select({ m: stockMovements, locationName: stockLocations.name })
    .from(stockMovements)
    .innerJoin(stockLocations, eq(stockLocations.id, stockMovements.locationId))
    .where(eq(stockMovements.variantId, variantId))
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit);
}

export type MovementFilter = { from?: Date; to?: Date; reason?: string; locationId?: string; q?: string; limit?: number; offset?: number };

export async function searchMovements(db: DB, actor: Actor, f: MovementFilter = {}) {
  authorize(actor, "inventory.read");
  const conds: SQL[] = [];
  if (f.from) conds.push(gte(stockMovements.createdAt, f.from));
  if (f.to) conds.push(lt(stockMovements.createdAt, f.to));
  if (f.reason) conds.push(eq(stockMovements.reason, f.reason));
  if (f.locationId) conds.push(eq(stockMovements.locationId, f.locationId));
  if (f.q) {
    const q = `%${f.q.replace(/[%_\\]/g, "\\$&").slice(0, 80)}%`;
    conds.push(or(ilike(productVariants.sku, q), ilike(products.name, q))!);
  }
  return db
    .select({ m: stockMovements, sku: productVariants.sku, productName: products.name, variantName: productVariants.name, locationName: stockLocations.name, actorName: users.name })
    .from(stockMovements)
    .innerJoin(productVariants, eq(productVariants.id, stockMovements.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(stockLocations, eq(stockLocations.id, stockMovements.locationId))
    .leftJoin(users, eq(users.id, stockMovements.actorUserId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(stockMovements.createdAt))
    .limit(Math.min(f.limit ?? 100, 5000))
    .offset(f.offset ?? 0);
}

export type StockRow = Awaited<ReturnType<typeof stockOverview>>[number];

/** Every stock-tracked item with SES and partner quantities, availability, value (SES stock at cost) and reorder state. */
export async function stockOverview(db: DB, actor: Actor, f: { q?: string; locationId?: string; categoryId?: string; lowOnly?: boolean } = {}) {
  authorize(actor, "inventory.read");
  const conds: SQL[] = [eq(productVariants.tracksStock, true), sql`${products.status} <> 'retired'`];
  if (f.q) {
    const q = `%${f.q.replace(/[%_\\]/g, "\\$&").slice(0, 80)}%`;
    conds.push(or(ilike(productVariants.sku, q), ilike(products.name, q), ilike(productVariants.barcode, q))!);
  }
  if (f.categoryId) {
    const kids = await db.select({ id: categories.id }).from(categories).where(eq(categories.parentId, f.categoryId));
    conds.push(inArray(products.categoryId, [f.categoryId, ...kids.map((k) => k.id)]));
  }
  const items = await db
    .select({ v: productVariants, productId: products.id, productName: products.name, categoryName: categories.name })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .where(and(...conds))
    .orderBy(asc(products.name), asc(productVariants.sku))
    .limit(5000);
  const levels = await levelsForVariants(db, items.map((i) => i.v.id));
  const now = new Date();
  const rows = items.map((i) => {
    const ls = levels.filter((l) => l.variantId === i.v.id);
    const own = ls.filter((l) => !l.connectionId);
    const at = f.locationId ? ls.filter((l) => l.locationId === f.locationId) : own;
    const onHand = at.reduce((a, l) => a + l.onHand, 0);
    const reserved = at.reduce((a, l) => a + l.reserved, 0);
    const availability = computeAvailability(ls, true, now, i.v.reorderPoint ?? LOW_STOCK_AT);
    const partnerAvailable = ls.filter((l) => l.connectionId && isFresh(l, now)).reduce((a, l) => a + Math.max(0, l.onHand - l.reserved), 0);
    return {
      variantId: i.v.id,
      productId: i.productId,
      sku: i.v.sku,
      barcode: i.v.barcode,
      name: i.v.name === "Standard" ? i.productName : `${i.productName} — ${i.v.name}`,
      categoryName: i.categoryName,
      levels: ls,
      onHand,
      reserved,
      available: availability.available,
      partnerAvailable,
      status: availability.status,
      costMinor: i.v.costMinor,
      valueMinor: own.reduce((a, l) => a + l.onHand, 0) * (i.v.costMinor ?? 0),
      reorderPoint: i.v.reorderPoint,
      reorderQty: i.v.reorderQty,
      leadTimeDays: i.v.leadTimeDays,
      preferredSupplierId: i.v.preferredSupplierId,
      serialTracked: i.v.serialTracked,
      reorder: i.v.reorderPoint !== null && availability.available - partnerAvailable <= i.v.reorderPoint,
    };
  });
  return f.lowOnly ? rows.filter((r) => r.reorder || r.status === "out_of_stock") : rows;
}

/** SES-held items at or below their reorder point (partner stock is the partner's to replenish). */
export async function reorderList(db: DB, actor: Actor) {
  const rows = (await stockOverview(db, actor)).filter((r) => r.reorder);
  return rows.map((r) => {
    const own = r.available - r.partnerAvailable;
    return { ...r, ownAvailable: own, suggestedQty: Math.max(r.reorderQty ?? 0, (r.reorderPoint ?? 0) - own + 1, 1) };
  });
}

export const stockSettingsInput = z.object({
  barcode: z.union([z.literal(""), z.string().trim().regex(/^[A-Za-z0-9-]{4,40}$/, "Barcode: 4–40 letters, digits or dashes.")]),
  reorderPoint: z.number().int().min(0).max(1_000_000).nullable(),
  reorderQty: z.number().int().min(1).max(1_000_000).nullable(),
  leadTimeDays: z.number().int().min(0).max(365).nullable(),
  serialTracked: z.boolean(),
  preferredSupplierId: z.string().uuid().nullable().optional(),
});

export async function updateStockSettings(db: DB, actor: Actor, variantId: string, input: z.input<typeof stockSettingsInput>) {
  authorize(actor, "catalogue.write");
  const d = stockSettingsInput.parse(input);
  await db.transaction(async (tx) => {
    const [v] = await tx.select().from(productVariants).where(eq(productVariants.id, variantId)).for("update");
    if (!v) throw notFound("Unknown variant.");
    if (d.barcode) {
      const [clash] = await tx.select({ id: productVariants.id, sku: productVariants.sku }).from(productVariants).where(eq(productVariants.barcode, d.barcode));
      if (clash && clash.id !== variantId) throw conflict(`Barcode ${d.barcode} is already on ${clash.sku}.`);
    }
    if (d.serialTracked !== v.serialTracked) {
      const [held] = await tx
        .select({ n: sql<number>`coalesce(sum(${stockLevels.onHand}), 0)::int` })
        .from(stockLevels)
        .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
        .where(and(eq(stockLevels.variantId, variantId), isNull(stockLocations.connectionId)));
      if (held!.n > 0) throw conflict("Serial tracking can only be switched while none are in SES stock (count it to 0, change, then receive with serials).");
    }
    await tx
      .update(productVariants)
      .set({ barcode: d.barcode || null, reorderPoint: d.reorderPoint, reorderQty: d.reorderQty, leadTimeDays: d.leadTimeDays, serialTracked: d.serialTracked, preferredSupplierId: d.preferredSupplierId ?? null, lowStockNotifiedAt: null })
      .where(eq(productVariants.id, variantId));
    await audit(tx, { actor, action: "variant.stock_settings", targetType: "variant", targetId: variantId, data: { sku: v.sku, ...d } });
  });
}

// ───────────────────────────── Serial numbers ─────────────────────────────

export async function searchSerials(db: DB, actor: Actor, q: string) {
  authorize(actor, "inventory.read");
  const term = q.trim().toUpperCase();
  if (term.length < 2) return [];
  return db
    .select({ s: stockSerials, sku: productVariants.sku, productName: products.name, locationName: stockLocations.name, orderNumber: orders.number, customer: organizations.name })
    .from(stockSerials)
    .innerJoin(productVariants, eq(productVariants.id, stockSerials.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(stockLocations, eq(stockLocations.id, stockSerials.locationId))
    .leftJoin(orders, eq(orders.id, stockSerials.orderId))
    .leftJoin(organizations, eq(organizations.id, orders.customerOrgId))
    .where(ilike(stockSerials.serial, `%${term.replace(/[%_\\]/g, "\\$&")}%`))
    .orderBy(asc(stockSerials.serial))
    .limit(100);
}

export async function serialsInStock(db: DB, variantId: string, locationId?: string) {
  return db
    .select({ serial: stockSerials.serial, locationId: stockSerials.locationId })
    .from(stockSerials)
    .where(and(eq(stockSerials.variantId, variantId), eq(stockSerials.status, "in_stock"), locationId ? eq(stockSerials.locationId, locationId) : undefined))
    .orderBy(asc(stockSerials.serial));
}

// ───────────────────────────── Alerts ─────────────────────────────

/** Hourly: tells stock staff once when an SES-held item falls to its reorder point; resets when it recovers. */
export async function checkLowStock(db: DB, now = new Date()) {
  const items = await db
    .select({ v: productVariants, productName: products.name })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(eq(productVariants.tracksStock, true), eq(productVariants.active, true), isNotNull(productVariants.reorderPoint), sql`${products.status} <> 'retired'`));
  if (items.length === 0) return { alerted: 0, recovered: 0 };
  const levels = (await levelsForVariants(db, items.map((i) => i.v.id))).filter((l) => !l.connectionId);
  const low: typeof items = [];
  let recovered = 0;
  for (const i of items) {
    const available = computeAvailability(levels.filter((l) => l.variantId === i.v.id), true, now).available;
    if (available <= i.v.reorderPoint! && !i.v.lowStockNotifiedAt) low.push(i);
    if (available > i.v.reorderPoint! && i.v.lowStockNotifiedAt) {
      await db.update(productVariants).set({ lowStockNotifiedAt: null }).where(eq(productVariants.id, i.v.id));
      recovered++;
    }
  }
  if (low.length) {
    await db.transaction(async (tx) => {
      await tx.update(productVariants).set({ lowStockNotifiedAt: now }).where(inArray(productVariants.id, low.map((l) => l.v.id)));
      const names = low.slice(0, 8).map((l) => `${l.productName} (${l.v.sku})`).join(", ");
      await notifyPermission(tx, "inventory.adjust", { title: `${low.length} item${low.length === 1 ? "" : "s"} at or below reorder level`, body: names + (low.length > 8 ? ` and ${low.length - 8} more` : ""), link: "/ops/inventory/reorder" });
    });
    publish({ topic: "notifications" });
  }
  return { alerted: low.length, recovered };
}
