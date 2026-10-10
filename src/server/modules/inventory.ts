import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { integrationConnections, orders, productVariants, stockLevels, stockLocations, stockMovements, stockReservations } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { conflict, invalid, notFound } from "../lib/errors";
import { audit } from "./audit";
import { publish } from "./events";

export type AvailabilityStatus = "in_stock" | "low_stock" | "out_of_stock" | "unconfirmed" | "not_tracked";

export interface LevelForAvailability {
  onHand: number;
  reserved: number;
  sourceUpdatedAt: Date;
  /** null for SES-managed stock (never stale) */
  staleAfterSeconds: number | null;
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

export function computeAvailability(levels: LevelForAvailability[], tracksStock: boolean, now = new Date()): Availability {
  const partnerLevels = levels.filter((l) => l.staleAfterSeconds !== null);
  const lastSyncAt = partnerLevels.length
    ? new Date(Math.max(...partnerLevels.map((l) => l.sourceUpdatedAt.getTime())))
    : null;
  if (!tracksStock) return { status: "not_tracked", available: 0, lastSyncAt, stale: false, purchasable: true };
  const fresh = levels.filter((l) => isFresh(l, now));
  const stale = fresh.length < levels.length;
  const available = fresh.reduce((sum, l) => sum + Math.max(0, l.onHand - l.reserved), 0);
  let status: AvailabilityStatus;
  if (available === 0 && stale) status = "unconfirmed";
  else if (available === 0) status = "out_of_stock";
  else if (available <= LOW_STOCK_AT) status = "low_stock";
  else status = "in_stock";
  return { status, available, lastSyncAt, stale, purchasable: available > 0 };
}

/** Stock rows for variants, with the staleness window of the supplying connection. */
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

/**
 * Reserve stock for an order inside the caller's transaction.
 * Rows are locked (SELECT … FOR UPDATE) so concurrent checkouts cannot oversell.
 * SES stock is used before partner stock; stale partner stock is never reserved.
 */
export async function reserveForOrder(
  tx: DB,
  orderId: string,
  lines: { variantId: string; quantity: number; sku: string }[],
  expiresAt: Date | null,
  now = new Date(),
) {
  const allocations: { variantId: string; connectionId: string | null; quantity: number }[] = [];
  for (const line of lines) {
    const rows = await tx
      .select({
        level: stockLevels,
        connectionId: stockLocations.connectionId,
        staleAfterSeconds: integrationConnections.staleAfterSeconds,
      })
      .from(stockLevels)
      .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
      .leftJoin(integrationConnections, eq(integrationConnections.id, stockLocations.connectionId))
      .where(eq(stockLevels.variantId, line.variantId))
      .orderBy(sql`${stockLocations.connectionId} IS NOT NULL`, asc(stockLocations.code))
      .for("update", { of: stockLevels });
    let remaining = line.quantity;
    for (const r of rows) {
      if (remaining === 0) break;
      if (!isFresh({ ...r.level, staleAfterSeconds: r.staleAfterSeconds }, now)) continue;
      const take = Math.min(remaining, r.level.onHand - r.level.reserved);
      if (take <= 0) continue;
      await tx
        .update(stockLevels)
        .set({ reserved: sql`${stockLevels.reserved} + ${take}` })
        .where(eq(stockLevels.id, r.level.id));
      await tx.insert(stockReservations).values({
        stockLevelId: r.level.id,
        variantId: line.variantId,
        orderId,
        quantity: take,
        expiresAt,
      });
      allocations.push({ variantId: line.variantId, connectionId: r.connectionId, quantity: take });
      remaining -= take;
    }
    if (remaining > 0) {
      throw conflict(`Not enough confirmed stock for ${line.sku}: ${line.quantity - remaining} of ${line.quantity} available.`);
    }
  }
  return allocations;
}

export interface MovementInput {
  variantId: string;
  locationId: string;
  quantity: number;
  reason: "receipt" | "adjustment" | "fulfilment" | "return";
  refType?: string;
  refId?: string;
  note?: string;
  actorUserId?: string | null;
}

/** Appends to the stock ledger (SES-managed locations only). Call inside the same transaction as the change. */
export async function recordMovement(tx: DB, m: MovementInput) {
  if (m.quantity === 0) return;
  await tx.insert(stockMovements).values({ ...m, refType: m.refType ?? null, refId: m.refId ?? null, note: m.note ?? null, actorUserId: m.actorUserId ?? null });
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

async function settleReservations(tx: DB, orderId: string, mode: "release" | "consume") {
  const active = await tx
    .select()
    .from(stockReservations)
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
  for (const r of active) {
    await tx
      .update(stockLevels)
      .set(
        mode === "consume"
          ? { reserved: sql`${stockLevels.reserved} - ${r.quantity}`, onHand: sql`GREATEST(${stockLevels.onHand} - ${r.quantity}, 0)` }
          : { reserved: sql`GREATEST(${stockLevels.reserved} - ${r.quantity}, 0)` },
      )
      .where(eq(stockLevels.id, r.stockLevelId));
    await tx
      .update(stockReservations)
      .set({ status: mode === "consume" ? "consumed" : "released" })
      .where(eq(stockReservations.id, r.id));
    if (mode === "consume") {
      const [lvl] = await tx
        .select({ locationId: stockLevels.locationId, connectionId: stockLocations.connectionId })
        .from(stockLevels)
        .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
        .where(eq(stockLevels.id, r.stockLevelId));
      if (lvl && !lvl.connectionId) {
        await recordMovement(tx, { variantId: r.variantId, locationId: lvl.locationId, quantity: -r.quantity, reason: "fulfilment", refType: "order", refId: orderId });
      }
    }
  }
  return active.length;
}

export const releaseReservations = (tx: DB, orderId: string) => settleReservations(tx, orderId, "release");
export const consumeReservations = (tx: DB, orderId: string) => settleReservations(tx, orderId, "consume");

export async function clearReservationExpiry(tx: DB, orderId: string) {
  await tx
    .update(stockReservations)
    .set({ expiresAt: null })
    .where(and(eq(stockReservations.orderId, orderId), eq(stockReservations.status, "active")));
}

/** Job: release holds for orders that were never confirmed. */
export async function expireReservations(db: DB, now = new Date()) {
  const expired = await db
    .selectDistinct({ orderId: stockReservations.orderId })
    .from(stockReservations)
    .where(and(eq(stockReservations.status, "active"), lt(stockReservations.expiresAt, now)));
  for (const { orderId } of expired) {
    await db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
      if (!order || order.status !== "pending") return;
      await releaseReservations(tx, orderId);
      await tx.update(orders).set({ status: "expired" }).where(eq(orders.id, orderId));
      await audit(tx, { action: "order.expired", targetType: "order", targetId: orderId, data: { reason: "reservation hold elapsed" } });
    });
    publish({ topic: "orders" });
  }
  return expired.length;
}

export async function listLocations(db: DB) {
  return db.select().from(stockLocations).orderBy(asc(stockLocations.code));
}

/** Manual count adjustment. Partner-supplied stock is owned by the partner feed and cannot be edited here. */
export async function adjustStock(db: DB, actor: Actor, input: { variantId: string; locationId: string; onHand: number; reason: string }) {
  authorize(actor, "inventory.adjust");
  if (!Number.isInteger(input.onHand) || input.onHand < 0) throw invalid("Quantity must be a whole number of 0 or more.");
  if (input.reason.trim().length < 3) throw invalid("Give a reason for the adjustment.");
  await db.transaction(async (tx) => {
    const [loc] = await tx.select().from(stockLocations).where(eq(stockLocations.id, input.locationId));
    if (!loc) throw notFound("Unknown location.");
    if (loc.connectionId) throw invalid("Partner stock is updated by the partner feed, not manually.");
    const [variant] = await tx.select().from(productVariants).where(eq(productVariants.id, input.variantId));
    if (!variant) throw notFound("Unknown variant.");
    const [existing] = await tx
      .select()
      .from(stockLevels)
      .where(and(eq(stockLevels.variantId, input.variantId), eq(stockLevels.locationId, input.locationId)))
      .for("update");
    if (existing && input.onHand < existing.reserved) {
      throw conflict(`Cannot set below the reserved quantity (${existing.reserved}). Release or fulfil those orders first.`);
    }
    if (existing) {
      await tx.update(stockLevels).set({ onHand: input.onHand, sourceUpdatedAt: new Date() }).where(eq(stockLevels.id, existing.id));
    } else {
      await tx.insert(stockLevels).values({ variantId: input.variantId, locationId: input.locationId, onHand: input.onHand });
    }
    await recordMovement(tx, {
      variantId: input.variantId,
      locationId: input.locationId,
      quantity: input.onHand - (existing?.onHand ?? 0),
      reason: "adjustment",
      note: input.reason,
      actorUserId: actor.userId,
    });
    await audit(tx, {
      actor,
      action: "stock.adjusted",
      targetType: "variant",
      targetId: input.variantId,
      data: { location: loc.code, from: existing?.onHand ?? 0, to: input.onHand, reason: input.reason },
    });
  });
  publish({ topic: "stock", data: { variantId: input.variantId } });
}
