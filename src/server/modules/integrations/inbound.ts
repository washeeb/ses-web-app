import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../../db/client";
import {
  approvalRequests,
  inboundEvents,
  integrationConnections,
  orderLines,
  orders,
  organizations,
  productMappings,
  products,
  productVariants,
  stockLevels,
  stockLocations,
  type PriceRule,
} from "../../db/schema";
import { decryptSecret } from "../../lib/crypto";
import { applyBp } from "../../lib/money";
import { log } from "../../lib/log";
import { hit } from "../../auth/rate-limit";
import { audit } from "../audit";
import { publish, type LiveEvent } from "../events";
import { enqueue, type JobRow } from "../jobs";
import { applyPrice, changeBp } from "../catalogue";
import { operatorOrgId } from "../settings";
import { notifyApprovers, notifyPermission } from "../notifications";
import { EVENT_SCHEMAS, envelopeSchema, SIGNATURE_HEADER, verifySignature, type Envelope, type InboundEventType } from "./contracts";

type Connection = typeof integrationConnections.$inferSelect;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Entry point for POST /api/v1/integrations/{connectionId}/events.
 * Verifies, de-duplicates and queues; processing happens asynchronously.
 */
export async function receiveWebhook(
  db: DB,
  req: { connectionId: string; rawBody: string; headers: Headers | Record<string, string | null> },
  now = new Date(),
): Promise<WebhookResult> {
  const header = (name: string) => (req.headers instanceof Headers ? req.headers.get(name) : (req.headers[name] ?? null));
  if (!UUID.test(req.connectionId)) return { status: 404, body: { error: "unknown_connection" } };
  const [conn] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, req.connectionId));
  if (!conn) return { status: 404, body: { error: "unknown_connection" } };
  if (conn.status !== "active") return { status: 409, body: { error: "connection_not_active" } };
  if (!(await hit(db, `webhook:${conn.id}`, 600, 60, now))) return { status: 429, body: { error: "rate_limited" } };
  if (req.rawBody.length > 256 * 1024) return { status: 413, body: { error: "payload_too_large" } };

  const check = verifySignature(decryptSecret(conn.inboundSecretEnc), req.rawBody, header(SIGNATURE_HEADER), Math.floor(now.getTime() / 1000));
  if (check !== "ok") {
    log.warn("webhook.signature_rejected", { connectionId: conn.id, reason: check });
    return { status: 401, body: { error: "invalid_signature", reason: check } };
  }

  let parsed: Envelope;
  try {
    const result = envelopeSchema.safeParse(JSON.parse(req.rawBody));
    if (!result.success) return { status: 400, body: { error: "invalid_envelope", issues: result.error.issues.slice(0, 10) } };
    parsed = result.data;
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  const dataCheck = EVENT_SCHEMAS[parsed.type].safeParse(parsed.data);
  if (!dataCheck.success) return { status: 400, body: { error: "invalid_data", issues: dataCheck.error.issues.slice(0, 10) } };

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(inboundEvents)
      .values({
        connectionId: conn.id,
        eventId: parsed.id,
        type: parsed.type,
        occurredAt: new Date(parsed.occurred_at),
        version: parsed.version,
        payload: dataCheck.data as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: [inboundEvents.connectionId, inboundEvents.eventId] })
      .returning();
    if (!row) return { status: 200, body: { status: "duplicate", id: parsed.id } };
    await enqueue(tx, { type: "integration.inbound.process", payload: { inboundEventId: row.id }, dedupeKey: `inbound:${row.id}` });
    await tx.update(integrationConnections).set({ lastEventAt: now }).where(eq(integrationConnections.id, conn.id));
    return { status: 202, body: { status: "accepted", id: parsed.id } };
  });
}

// ───────────────────────────── Processing ─────────────────────────────

type Outcome = { status: "processed" | "stale_ignored" | "rejected"; note?: string; live?: LiveEvent[] };

/** Thrown for problems that may resolve on retry (e.g. events arriving out of order). */
export class RetryableError extends Error {}

function priceFromCost(costMinor: number, rule: PriceRule) {
  return rule.type === "markup" ? costMinor + applyBp(costMinor, rule.bp) : costMinor + rule.minor;
}

const sesSku = (partnerSlug: string, sku: string) =>
  `P-${partnerSlug.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8)}-${sku.toUpperCase().replace(/[^A-Z0-9-]/g, "-")}`.slice(0, 41);

async function ensureLocation(tx: DB, conn: Connection, code: string) {
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, conn.partnerOrgId));
  const fullCode = `${org!.slug.toUpperCase()}-${conn.id.slice(0, 4).toUpperCase()}-${code.toUpperCase()}`;
  const [existing] = await tx.select().from(stockLocations).where(eq(stockLocations.code, fullCode));
  if (existing) return existing;
  const [loc] = await tx
    .insert(stockLocations)
    .values({ code: fullCode, name: `${org!.name} — ${code}${conn.mode === "simulator" ? " (simulated)" : ""}`, organizationId: org!.id, connectionId: conn.id })
    .returning();
  return loc!;
}

async function updateCost(tx: DB, conn: Connection, mapping: typeof productMappings.$inferSelect, cost: { amount_minor: number; currency: string }): Promise<string | undefined> {
  const [variant] = await tx.select().from(productVariants).where(eq(productVariants.id, mapping.variantId)).for("update");
  if (!variant) throw new Error("Mapped variant missing");
  if (cost.currency !== variant.currency) return `currency ${cost.currency} does not match ${variant.currency}; price not changed`;
  await tx.update(productMappings).set({ partnerCostMinor: cost.amount_minor, partnerCurrency: cost.currency }).where(eq(productMappings.id, mapping.id));
  const next = priceFromCost(cost.amount_minor, mapping.priceRule);
  if (next === variant.priceMinor) return undefined;
  const delta = changeBp(variant.priceMinor, next);
  if (variant.priceMinor > 0 && delta >= conn.sensitivePriceChangeBp) {
    // Supersede any older pending partner request for the same item.
    await tx
      .update(approvalRequests)
      .set({ status: "superseded", decidedAt: new Date() })
      .where(and(eq(approvalRequests.type, "price.change"), eq(approvalRequests.subjectId, variant.id), eq(approvalRequests.status, "pending")));
    await tx.insert(approvalRequests).values({
      organizationId: await operatorOrgId(tx),
      type: "price.change",
      subjectType: "variant",
      subjectId: variant.id,
      summary: `Partner price feed (${conn.name}) for ${variant.sku}: ${variant.priceMinor} → ${next} (${(delta / 100).toFixed(1)}%)`,
      payload: { variantId: variant.id, sku: variant.sku, fromMinor: variant.priceMinor, toMinor: next, currency: variant.currency, source: `partner:${conn.name}`, partnerCostMinor: cost.amount_minor },
      requestedBy: null,
    });
    await notifyApprovers(tx, "price.change", variant.id, `Partner price feed (${conn.name}) for ${variant.sku}`, null);
    return "price change held for approval";
  }
  await applyPrice(tx, variant.id, next, { source: `partner:${conn.name}` });
  return undefined;
}

async function handleProductUpserted(tx: DB, conn: Connection, ev: typeof inboundEvents.$inferSelect): Promise<Outcome> {
  const data = EVENT_SCHEMAS["product.upserted"].parse(ev.payload);
  const [mapping] = await tx
    .select()
    .from(productMappings)
    .where(and(eq(productMappings.connectionId, conn.id), eq(productMappings.partnerSku, data.sku)))
    .for("update");

  if (!mapping) {
    // New partner products always start as drafts: SES reviews before anything is sold.
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, conn.partnerOrgId));
    const slugBase = `${org!.slug}-${data.sku}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const [product] = await tx
      .insert(products)
      .values({
        slug: `${slugBase}-${conn.id.slice(0, 6)}`,
        name: data.name,
        summary: data.description?.slice(0, 300) ?? null,
        description: data.description ?? null,
        type: data.product_type,
        status: "draft",
        sourceConnectionId: conn.id,
        isDemo: conn.mode === "simulator",
      })
      .returning();
    const price = data.cost ? priceFromCost(data.cost.amount_minor, conn.defaultPriceRule) : 0;
    const [variant] = await tx
      .insert(productVariants)
      .values({
        productId: product!.id,
        sku: sesSku(org!.slug, data.sku),
        name: "Standard",
        priceMinor: price,
        currency: data.cost?.currency ?? "GHS",
        tracksStock: data.tracks_stock,
        active: data.active,
      })
      .returning();
    await tx.insert(productMappings).values({
      connectionId: conn.id,
      partnerSku: data.sku,
      variantId: variant!.id,
      fieldOwnership: conn.defaultFieldOwnership,
      priceRule: conn.defaultPriceRule,
      partnerCostMinor: data.cost?.amount_minor ?? null,
      partnerCurrency: data.cost?.currency ?? null,
      sourceVersion: ev.version,
      lastSyncedAt: new Date(),
    });
    await audit(tx, { action: "integration.product_created", targetType: "product", targetId: product!.id, data: { connection: conn.name, partnerSku: data.sku, sesSku: variant!.sku } });
    return { status: "processed", note: "new product created as draft", live: [{ topic: "catalogue" }] };
  }

  if (ev.version <= mapping.sourceVersion) return { status: "stale_ignored", note: `version ${ev.version} <= ${mapping.sourceVersion}` };
  const own = mapping.fieldOwnership;
  const [variant] = await tx.select().from(productVariants).where(eq(productVariants.id, mapping.variantId));
  const productPatch: Partial<typeof products.$inferInsert> = {};
  if (own.name === "partner") productPatch.name = data.name;
  if (own.description === "partner" && data.description !== undefined) productPatch.description = data.description;
  if (Object.keys(productPatch).length) await tx.update(products).set(productPatch).where(eq(products.id, variant!.productId));
  if (own.status === "partner" && variant!.active !== data.active) {
    await tx.update(productVariants).set({ active: data.active }).where(eq(productVariants.id, variant!.id));
  }
  let note: string | undefined;
  if (own.cost === "partner" && data.cost) note = await updateCost(tx, conn, mapping, data.cost);
  await tx.update(productMappings).set({ sourceVersion: ev.version, lastSyncedAt: new Date() }).where(eq(productMappings.id, mapping.id));
  return { status: "processed", note, live: [{ topic: "catalogue" }, { topic: "approvals" }] };
}

async function handlePriceUpdated(tx: DB, conn: Connection, ev: typeof inboundEvents.$inferSelect): Promise<Outcome> {
  const data = EVENT_SCHEMAS["price.updated"].parse(ev.payload);
  const [mapping] = await tx
    .select()
    .from(productMappings)
    .where(and(eq(productMappings.connectionId, conn.id), eq(productMappings.partnerSku, data.sku)))
    .for("update");
  if (!mapping) throw new RetryableError(`Unknown SKU ${data.sku}; waiting for product.upserted`);
  if (ev.version <= mapping.sourceVersion) return { status: "stale_ignored", note: `version ${ev.version} <= ${mapping.sourceVersion}` };
  if (mapping.fieldOwnership.cost !== "partner") return { status: "processed", note: "cost owned by SES; ignored" };
  const note = await updateCost(tx, conn, mapping, data.cost);
  await tx.update(productMappings).set({ sourceVersion: ev.version, lastSyncedAt: new Date() }).where(eq(productMappings.id, mapping.id));
  return { status: "processed", note, live: [{ topic: "catalogue" }, { topic: "approvals" }] };
}

async function handleProductRetired(tx: DB, conn: Connection, ev: typeof inboundEvents.$inferSelect): Promise<Outcome> {
  const data = EVENT_SCHEMAS["product.retired"].parse(ev.payload);
  const [mapping] = await tx.select().from(productMappings).where(and(eq(productMappings.connectionId, conn.id), eq(productMappings.partnerSku, data.sku)));
  if (!mapping) return { status: "rejected", note: `unknown SKU ${data.sku}` };
  if (ev.version <= mapping.sourceVersion) return { status: "stale_ignored" };
  if (mapping.fieldOwnership.status === "partner") {
    await tx.update(productVariants).set({ active: false }).where(eq(productVariants.id, mapping.variantId));
  }
  await tx.update(productMappings).set({ sourceVersion: ev.version, lastSyncedAt: new Date() }).where(eq(productMappings.id, mapping.id));
  return { status: "processed", live: [{ topic: "catalogue" }] };
}

async function handleStockUpdated(tx: DB, conn: Connection, ev: typeof inboundEvents.$inferSelect, now: Date): Promise<Outcome> {
  const data = EVENT_SCHEMAS["stock.updated"].parse(ev.payload);
  const [mapping] = await tx.select().from(productMappings).where(and(eq(productMappings.connectionId, conn.id), eq(productMappings.partnerSku, data.sku)));
  if (!mapping) throw new RetryableError(`Unknown SKU ${data.sku}; waiting for product.upserted`);
  if (mapping.fieldOwnership.stock !== "partner") return { status: "processed", note: "stock owned by SES; ignored" };
  const loc = await ensureLocation(tx, conn, data.location);
  // Data age is when the partner observed it, never in the future.
  const observedAt = ev.occurredAt > now ? now : ev.occurredAt;
  const [level] = await tx
    .select()
    .from(stockLevels)
    .where(and(eq(stockLevels.variantId, mapping.variantId), eq(stockLevels.locationId, loc.id)))
    .for("update");
  if (level && ev.version <= level.sourceVersion) return { status: "stale_ignored", note: `version ${ev.version} <= ${level.sourceVersion}` };
  if (level) {
    await tx.update(stockLevels).set({ onHand: data.on_hand, sourceVersion: ev.version, sourceUpdatedAt: observedAt }).where(eq(stockLevels.id, level.id));
  } else {
    await tx.insert(stockLevels).values({ variantId: mapping.variantId, locationId: loc.id, onHand: data.on_hand, sourceVersion: ev.version, sourceUpdatedAt: observedAt });
  }
  let note: string | undefined;
  if (level && data.on_hand < level.reserved) {
    note = `shortfall: partner reports ${data.on_hand} but ${level.reserved} reserved`;
    await audit(tx, { action: "stock.shortfall", targetType: "variant", targetId: mapping.variantId, data: { connection: conn.name, onHand: data.on_hand, reserved: level.reserved } });
  }
  await tx.update(productMappings).set({ lastSyncedAt: new Date() }).where(eq(productMappings.id, mapping.id));
  return { status: "processed", note, live: [{ topic: "stock", data: { variantId: mapping.variantId } }] };
}

async function handleFulfilment(tx: DB, conn: Connection, ev: typeof inboundEvents.$inferSelect): Promise<Outcome> {
  const data = EVENT_SCHEMAS["fulfilment.updated"].parse(ev.payload);
  const [order] = await tx.select().from(orders).where(eq(orders.number, data.order_number));
  // Partners may only touch lines assigned to their own connection. Unknown and foreign orders look identical.
  const conds = [eq(orderLines.orderId, order?.id ?? "00000000-0000-0000-0000-000000000000"), eq(orderLines.fulfilmentConnectionId, conn.id)];
  if (data.line_id) conds.push(eq(orderLines.id, data.line_id));
  const lines = await tx.select().from(orderLines).where(and(...conds)).for("update");
  if (!order || lines.length === 0) return { status: "rejected", note: "no matching order lines for this connection" };
  let updated = 0;
  for (const l of lines) {
    if (ev.version <= l.fulfilmentVersion) continue;
    await tx.update(orderLines).set({ fulfilmentStatus: data.status, fulfilmentVersion: ev.version }).where(eq(orderLines.id, l.id));
    updated++;
  }
  if (updated === 0) return { status: "stale_ignored" };
  await audit(tx, { action: "order.partner_fulfilment", targetType: "order", targetId: order.id, data: { connection: conn.name, status: data.status, lines: updated, tracking: data.tracking_reference } });
  return { status: "processed", live: [{ topic: "orders", orgIds: [order.customerOrgId, conn.partnerOrgId] }] };
}

const HANDLERS: Record<InboundEventType, (tx: DB, conn: Connection, ev: typeof inboundEvents.$inferSelect, now: Date) => Promise<Outcome>> = {
  "product.upserted": handleProductUpserted,
  "product.retired": handleProductRetired,
  "price.updated": handlePriceUpdated,
  "stock.updated": handleStockUpdated,
  "fulfilment.updated": handleFulfilment,
};

export async function processInboundEvent(db: DB, inboundEventId: string, now = new Date()) {
  let live: LiveEvent[] = [];
  let partnerOrgId: string | null = null;
  try {
    await db.transaction(async (tx) => {
      const [ev] = await tx.select().from(inboundEvents).where(eq(inboundEvents.id, inboundEventId)).for("update");
      if (!ev || ["processed", "stale_ignored", "rejected"].includes(ev.status)) return;
      const [conn] = await tx.select().from(integrationConnections).where(eq(integrationConnections.id, ev.connectionId));
      if (!conn) throw new Error("Connection missing");
      partnerOrgId = conn.partnerOrgId;
      const outcome = await HANDLERS[ev.type as InboundEventType](tx, conn, ev, now);
      await tx
        .update(inboundEvents)
        .set({ status: outcome.status, attempts: ev.attempts + 1, processedAt: now, lastError: outcome.note ?? null })
        .where(eq(inboundEvents.id, ev.id));
      await tx.update(integrationConnections).set({ lastSyncAt: now }).where(eq(integrationConnections.id, conn.id));
      live = outcome.live ?? [];
    });
  } catch (err) {
    await db
      .update(inboundEvents)
      .set({ status: "failed", attempts: sql`${inboundEvents.attempts} + 1`, lastError: err instanceof Error ? err.message.slice(0, 1000) : String(err) })
      .where(eq(inboundEvents.id, inboundEventId));
    publish({ topic: "integrations" });
    throw err;
  }
  for (const e of live) publish(e);
  publish({ topic: "integrations", orgIds: partnerOrgId ? [partnerOrgId] : [] });
}

/** Dead-letter hook: a job that exhausted its retries marks its event dead. */
export async function onInboundDead(db: DB, job: JobRow, error: string) {
  const id = (job.payload as { inboundEventId?: string }).inboundEventId;
  if (!id) return;
  await db.update(inboundEvents).set({ status: "dead", lastError: error.slice(0, 1000) }).where(eq(inboundEvents.id, id));
  await audit(db, { action: "integration.event_dead_lettered", targetType: "inbound_event", targetId: id, data: { error } });
  await notifyPermission(db, "integrations.manage", { title: "Partner event failed permanently", body: error.slice(0, 200), link: "/ops/integrations" });
  publish({ topic: "integrations" });
}
