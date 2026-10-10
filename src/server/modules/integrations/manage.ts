import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../../db/client";
import {
  apiCredentials,
  approvalRequests,
  inboundEvents,
  integrationConnections,
  jobs,
  orderLines,
  orders,
  organizations,
  productMappings,
  products,
  productVariants,
  stockLevels,
  stockLocations,
  type FieldOwnership,
  type PriceRule,
} from "../../db/schema";
import { authorize, can, type Actor } from "../../authz/policy";
import { encryptSecret, randomToken, sha256 } from "../../lib/crypto";
import { conflict, forbidden, invalid, notFound } from "../../lib/errors";
import { hit } from "../../auth/rate-limit";
import { audit } from "../audit";
import { publish } from "../events";
import { enqueue, requeueJob } from "../jobs";
import { isFresh } from "../inventory";
import { API_SCOPES, type ApiScope } from "./contracts";
import { validateOutboundUrl } from "./outbound";

export const DEFAULT_OWNERSHIP: FieldOwnership = { name: "partner", description: "ses", cost: "partner", stock: "partner", status: "partner" };
export const DEFAULT_PRICE_RULE: PriceRule = { type: "markup", bp: 2000 };

// ───────────────────────────── Connections ─────────────────────────────

export async function listConnections(db: DB, actor: Actor) {
  authorize(actor, "integrations.read");
  const conns = await db
    .select({ c: integrationConnections, partnerName: organizations.name })
    .from(integrationConnections)
    .innerJoin(organizations, eq(organizations.id, integrationConnections.partnerOrgId))
    .orderBy(organizations.name);
  return Promise.all(conns.map(async ({ c, partnerName }) => ({ ...c, partnerName, health: await connectionHealth(db, c) })));
}

export interface ConnectionHealth {
  state: "healthy" | "degraded" | "failing" | "idle";
  counts24h: Record<string, number>;
  dead: number;
  failing: number;
  staleStockRows: number;
  pendingOutbound: number;
  deadOutbound: number;
}

async function connectionHealth(db: DB, c: typeof integrationConnections.$inferSelect, now = new Date()): Promise<ConnectionHealth> {
  const since = new Date(now.getTime() - 86_400_000);
  const counts = await db
    .select({ status: inboundEvents.status, n: sql<number>`count(*)::int` })
    .from(inboundEvents)
    .where(and(eq(inboundEvents.connectionId, c.id), gte(inboundEvents.receivedAt, since)))
    .groupBy(inboundEvents.status);
  const [{ dead, failing }] = (await db
    .select({
      dead: sql<number>`count(*) filter (where ${inboundEvents.status} = 'dead')::int`,
      failing: sql<number>`count(*) filter (where ${inboundEvents.status} = 'failed')::int`,
    })
    .from(inboundEvents)
    .where(eq(inboundEvents.connectionId, c.id))) as [{ dead: number; failing: number }];
  const levels = await db
    .select({ sourceUpdatedAt: stockLevels.sourceUpdatedAt, onHand: stockLevels.onHand, reserved: stockLevels.reserved })
    .from(stockLevels)
    .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
    .where(eq(stockLocations.connectionId, c.id));
  const staleStockRows = levels.filter((l) => !isFresh({ ...l, staleAfterSeconds: c.staleAfterSeconds }, now)).length;
  const outbound = await db
    .select({ status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.type, "integration.outbound.deliver"), sql`${jobs.payload}->>'connectionId' = ${c.id}`))
    .groupBy(jobs.status);
  const ob = Object.fromEntries(outbound.map((o) => [o.status, o.n]));
  const counts24h = Object.fromEntries(counts.map((r) => [r.status, r.n]));
  const deadOutbound = ob.dead ?? 0;
  let state: ConnectionHealth["state"] = "healthy";
  if (!c.lastEventAt) state = "idle";
  if (failing > 0 || staleStockRows > 0) state = "degraded";
  if (dead > 0 || deadOutbound > 0) state = "failing";
  return { state, counts24h, dead, failing, staleStockRows, pendingOutbound: (ob.queued ?? 0) + (ob.running ?? 0), deadOutbound };
}

export async function getConnectionDetail(db: DB, actor: Actor, id: string) {
  authorize(actor, "integrations.read");
  const [row] = await db
    .select({ c: integrationConnections, partner: organizations })
    .from(integrationConnections)
    .innerJoin(organizations, eq(organizations.id, integrationConnections.partnerOrgId))
    .where(eq(integrationConnections.id, id));
  if (!row) throw notFound("Connection not found.");
  const [events, mappings, keys, outbound, priceApprovals] = await Promise.all([
    db.select().from(inboundEvents).where(eq(inboundEvents.connectionId, id)).orderBy(desc(inboundEvents.receivedAt)).limit(100),
    mappingsForConnections(db, [id]),
    db.select().from(apiCredentials).where(eq(apiCredentials.connectionId, id)).orderBy(desc(apiCredentials.createdAt)),
    db
      .select()
      .from(jobs)
      .where(and(eq(jobs.type, "integration.outbound.deliver"), sql`${jobs.payload}->>'connectionId' = ${id}`))
      .orderBy(desc(jobs.createdAt))
      .limit(50),
    db
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.type, "price.change"), eq(approvalRequests.status, "pending"), sql`${approvalRequests.payload}->>'source' = ${"partner:" + row.c.name}`)),
  ]);
  return {
    connection: row.c,
    partner: row.partner,
    health: await connectionHealth(db, row.c),
    events,
    mappings,
    keys: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, environment: k.environment, scopes: k.scopes, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt, expiresAt: k.expiresAt, createdAt: k.createdAt })),
    outbound,
    priceApprovals,
  };
}

async function mappingsForConnections(db: DB, connectionIds: string[], now = new Date()) {
  if (connectionIds.length === 0) return [];
  const rows = await db
    .select({
      mapping: productMappings,
      sku: productVariants.sku,
      priceMinor: productVariants.priceMinor,
      currency: productVariants.currency,
      variantActive: productVariants.active,
      productId: products.id,
      productName: products.name,
      productStatus: products.status,
      staleAfterSeconds: integrationConnections.staleAfterSeconds,
    })
    .from(productMappings)
    .innerJoin(productVariants, eq(productVariants.id, productMappings.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(integrationConnections, eq(integrationConnections.id, productMappings.connectionId))
    .where(inArray(productMappings.connectionId, connectionIds))
    .orderBy(productMappings.partnerSku);
  const levels = await db
    .select({ variantId: stockLevels.variantId, onHand: stockLevels.onHand, reserved: stockLevels.reserved, sourceUpdatedAt: stockLevels.sourceUpdatedAt, connectionId: stockLocations.connectionId })
    .from(stockLevels)
    .innerJoin(stockLocations, eq(stockLocations.id, stockLevels.locationId))
    .where(inArray(stockLocations.connectionId, connectionIds));
  return rows.map((r) => {
    const own = levels.filter((l) => l.variantId === r.mapping.variantId && l.connectionId === r.mapping.connectionId);
    const lastStockAt = own.length ? new Date(Math.max(...own.map((l) => l.sourceUpdatedAt.getTime()))) : null;
    return {
      ...r,
      onHand: own.reduce((a, l) => a + l.onHand, 0),
      reserved: own.reduce((a, l) => a + l.reserved, 0),
      lastStockAt,
      stockStale: own.some((l) => !isFresh({ ...l, staleAfterSeconds: r.staleAfterSeconds }, now)),
    };
  });
}

export const connectionInput = z.object({
  partnerOrgId: z.string().uuid(),
  name: z.string().trim().min(3).max(100),
  mode: z.enum(["simulator", "production"]),
  outboundUrl: z.string().trim().max(500).optional().default(""),
  staleAfterSeconds: z.number().int().min(60).max(7 * 86_400).default(900),
  sensitivePriceChangeBp: z.number().int().min(100).max(100_000).default(1500),
  markupBp: z.number().int().min(0).max(100_000).default(2000),
});

/** Returns the plaintext secrets once; only encrypted copies are stored. */
export async function createConnection(db: DB, actor: Actor, input: z.input<typeof connectionInput>) {
  authorize(actor, "integrations.manage");
  const data = connectionInput.parse(input);
  const [partner] = await db.select().from(organizations).where(and(eq(organizations.id, data.partnerOrgId), eq(organizations.type, "partner")));
  if (!partner) throw invalid("Choose a partner organisation.");
  if (data.mode === "simulator" && process.env.SIMULATORS_ENABLED !== "true") throw invalid("Simulators are disabled in this environment.");
  if (data.outboundUrl) {
    const problem = validateOutboundUrl(data.outboundUrl, data.mode);
    if (problem) throw invalid(problem);
  }
  const inboundSecret = `whsec_${randomToken(32)}`;
  const outboundSecret = `whsec_${randomToken(32)}`;
  const [conn] = await db
    .insert(integrationConnections)
    .values({
      partnerOrgId: partner.id,
      name: data.name,
      mode: data.mode,
      inboundSecretEnc: encryptSecret(inboundSecret),
      outboundUrl: data.outboundUrl || null,
      outboundSecretEnc: encryptSecret(outboundSecret),
      staleAfterSeconds: data.staleAfterSeconds,
      sensitivePriceChangeBp: data.sensitivePriceChangeBp,
      defaultFieldOwnership: DEFAULT_OWNERSHIP,
      defaultPriceRule: { type: "markup", bp: data.markupBp },
    })
    .returning();
  await audit(db, { actor, action: "integration.connection_created", targetType: "connection", targetId: conn!.id, data: { partner: partner.name, mode: data.mode } });
  return { connection: conn!, inboundSecret, outboundSecret };
}

export async function rotateSecrets(db: DB, actor: Actor, id: string) {
  authorize(actor, "integrations.manage");
  const inboundSecret = `whsec_${randomToken(32)}`;
  const outboundSecret = `whsec_${randomToken(32)}`;
  const [c] = await db
    .update(integrationConnections)
    .set({ inboundSecretEnc: encryptSecret(inboundSecret), outboundSecretEnc: encryptSecret(outboundSecret) })
    .where(eq(integrationConnections.id, id))
    .returning();
  if (!c) throw notFound("Connection not found.");
  await audit(db, { actor, action: "integration.secrets_rotated", targetType: "connection", targetId: id });
  return { inboundSecret, outboundSecret };
}

export async function setConnectionStatus(db: DB, actor: Actor, id: string, status: "active" | "paused" | "disabled") {
  authorize(actor, "integrations.manage");
  const [c] = await db.update(integrationConnections).set({ status }).where(eq(integrationConnections.id, id)).returning();
  if (!c) throw notFound("Connection not found.");
  await audit(db, { actor, action: "integration.status_changed", targetType: "connection", targetId: id, data: { status } });
  publish({ topic: "integrations" });
}

/** Manual replay of a failed or dead-lettered inbound event. */
export async function replayEvent(db: DB, actor: Actor, inboundEventId: string) {
  authorize(actor, "integrations.manage");
  await db.transaction(async (tx) => {
    const [ev] = await tx.select().from(inboundEvents).where(eq(inboundEvents.id, inboundEventId)).for("update");
    if (!ev) throw notFound("Event not found.");
    if (!["failed", "dead"].includes(ev.status)) throw conflict("Only failed or dead-lettered events can be replayed.");
    await tx.update(inboundEvents).set({ status: "received", lastError: null }).where(eq(inboundEvents.id, ev.id));
    await enqueue(tx, { type: "integration.inbound.process", payload: { inboundEventId: ev.id }, dedupeKey: `inbound:${ev.id}:replay:${Date.now()}` });
    await audit(tx, { actor, action: "integration.event_replayed", targetType: "inbound_event", targetId: ev.id });
  });
  publish({ topic: "integrations" });
}

export async function replayOutbound(db: DB, actor: Actor, jobId: string) {
  authorize(actor, "integrations.manage");
  await requeueJob(db, jobId);
  await audit(db, { actor, action: "integration.outbound_replayed", targetType: "job", targetId: jobId });
}

export async function updateMapping(db: DB, actor: Actor, mappingId: string, input: { fieldOwnership: FieldOwnership; markupBp: number }) {
  authorize(actor, "integrations.manage");
  const own = z.object({
    name: z.enum(["partner", "ses"]),
    description: z.enum(["partner", "ses"]),
    cost: z.enum(["partner", "ses"]),
    stock: z.enum(["partner", "ses"]),
    status: z.enum(["partner", "ses"]),
  }).parse(input.fieldOwnership);
  const markup = z.number().int().min(0).max(100_000).parse(input.markupBp);
  const [m] = await db.update(productMappings).set({ fieldOwnership: own, priceRule: { type: "markup", bp: markup } }).where(eq(productMappings.id, mappingId)).returning();
  if (!m) throw notFound("Mapping not found.");
  await audit(db, { actor, action: "integration.mapping_updated", targetType: "mapping", targetId: mappingId, data: { fieldOwnership: own, markupBp: markup } });
}

// ───────────────────────────── API credentials ─────────────────────────────

export async function createApiKey(db: DB, actor: Actor, input: { connectionId: string; name: string; scopes: string[] }) {
  authorize(actor, "integrations.manage");
  const scopes = z.array(z.enum(API_SCOPES)).min(1, "Choose at least one scope.").parse(input.scopes);
  const name = z.string().trim().min(3).max(80).parse(input.name);
  const [conn] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, input.connectionId));
  if (!conn) throw notFound("Connection not found.");
  const env = conn.mode === "production" ? "live" : "test";
  const prefix = randomToken(6).replace(/[^A-Za-z0-9]/g, "x").slice(0, 8);
  const secret = randomToken(32);
  const key = `ses_${env}_${prefix}_${secret}`;
  const [row] = await db
    .insert(apiCredentials)
    .values({ organizationId: conn.partnerOrgId, connectionId: conn.id, name, prefix, keyHash: sha256(key), scopes, environment: env, createdBy: actor.userId, expiresAt: new Date(Date.now() + 365 * 86_400_000) })
    .returning();
  await audit(db, { actor, action: "integration.api_key_created", targetType: "api_key", targetId: row!.id, data: { prefix, scopes, connection: conn.name } });
  return { key, prefix };
}

export async function revokeApiKey(db: DB, actor: Actor, id: string) {
  authorize(actor, "integrations.manage");
  const [k] = await db.update(apiCredentials).set({ revokedAt: new Date() }).where(eq(apiCredentials.id, id)).returning();
  if (!k) throw notFound("Key not found.");
  await audit(db, { actor, action: "integration.api_key_revoked", targetType: "api_key", targetId: id, data: { prefix: k.prefix } });
}

export type ApiAuth = { ok: true; organizationId: string; connectionId: string | null; scopes: ApiScope[]; prefix: string } | { ok: false; status: 401 | 403 | 429; error: string };

/** Validates `Authorization: Bearer ses_<env>_<prefix>_<secret>` and a required scope. */
export async function authenticateApiKey(db: DB, authorization: string | null, scope: ApiScope, now = new Date()): Promise<ApiAuth> {
  const m = /^Bearer (ses_(test|live)_([A-Za-z0-9]{8})_[A-Za-z0-9_-]{20,})$/.exec(authorization ?? "");
  if (!m) return { ok: false, status: 401, error: "missing_or_malformed_key" };
  const [cred] = await db.select().from(apiCredentials).where(eq(apiCredentials.prefix, m[3]!));
  if (!cred || cred.keyHash !== sha256(m[1]!) || cred.revokedAt || (cred.expiresAt && cred.expiresAt < now)) {
    return { ok: false, status: 401, error: "invalid_key" };
  }
  if (!(await hit(db, `apikey:${cred.prefix}`, 120, 60, now))) return { ok: false, status: 429, error: "rate_limited" };
  if (!cred.scopes.includes(scope)) return { ok: false, status: 403, error: "insufficient_scope" };
  await db.update(apiCredentials).set({ lastUsedAt: now }).where(eq(apiCredentials.id, cred.id));
  return { ok: true, organizationId: cred.organizationId, connectionId: cred.connectionId, scopes: cred.scopes as ApiScope[], prefix: cred.prefix };
}

// ───────────────────────────── Partner-scoped reads (portal and API) ─────────────────────────────

async function partnerConnectionIds(db: DB, partnerOrgId: string) {
  const rows = await db.select({ id: integrationConnections.id }).from(integrationConnections).where(eq(integrationConnections.partnerOrgId, partnerOrgId));
  return rows.map((r) => r.id);
}

function assertPartnerScope(actor: Actor, perm: "partner.catalogue.read" | "partner.orders.read" | "partner.integration.read") {
  if (!can(actor, perm, { organizationId: actor.organizationId })) throw forbidden();
  return actor.organizationId;
}

/** Partners see their cost and stock for mapped items — never SES sell prices or other partners' data. */
export async function partnerMappings(db: DB, partnerOrgId: string) {
  const rows = await mappingsForConnections(db, await partnerConnectionIds(db, partnerOrgId));
  return rows.map((r) => ({
    partnerSku: r.mapping.partnerSku,
    sesSku: r.sku,
    productName: r.productName,
    listed: r.productStatus === "active" && r.variantActive,
    partnerCostMinor: r.mapping.partnerCostMinor,
    partnerCurrency: r.mapping.partnerCurrency,
    onHand: r.onHand,
    reserved: r.reserved,
    lastSyncedAt: r.mapping.lastSyncedAt,
    lastStockAt: r.lastStockAt,
    stockStale: r.stockStale,
  }));
}

export async function partnerFulfilmentRequests(db: DB, partnerOrgId: string) {
  const ids = await partnerConnectionIds(db, partnerOrgId);
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      lineId: orderLines.id,
      orderNumber: orders.number,
      orderStatus: orders.status,
      quantity: orderLines.quantity,
      fulfilmentStatus: orderLines.fulfilmentStatus,
      connectionId: orderLines.fulfilmentConnectionId,
      variantId: orderLines.variantId,
      createdAt: orders.createdAt,
    })
    .from(orderLines)
    .innerJoin(orders, eq(orders.id, orderLines.orderId))
    .where(and(inArray(orderLines.fulfilmentConnectionId, ids), inArray(orders.status, ["confirmed", "fulfilled", "cancelled"])))
    .orderBy(desc(orders.createdAt))
    .limit(200);
  const maps = await db.select().from(productMappings).where(inArray(productMappings.connectionId, ids));
  return rows.map((r) => ({ ...r, partnerSku: maps.find((m) => m.variantId === r.variantId && m.connectionId === r.connectionId)?.partnerSku ?? null }));
}

export async function partnerRecentEvents(db: DB, partnerOrgId: string) {
  const ids = await partnerConnectionIds(db, partnerOrgId);
  if (ids.length === 0) return [];
  return db
    .select({ eventId: inboundEvents.eventId, type: inboundEvents.type, status: inboundEvents.status, receivedAt: inboundEvents.receivedAt, lastError: inboundEvents.lastError })
    .from(inboundEvents)
    .where(inArray(inboundEvents.connectionId, ids))
    .orderBy(desc(inboundEvents.receivedAt))
    .limit(50);
}

export async function partnerOverview(db: DB, actor: Actor) {
  const orgId = assertPartnerScope(actor, "partner.integration.read");
  const conns = await db
    .select({ id: integrationConnections.id, name: integrationConnections.name, mode: integrationConnections.mode, status: integrationConnections.status, lastEventAt: integrationConnections.lastEventAt, lastSyncAt: integrationConnections.lastSyncAt, staleAfterSeconds: integrationConnections.staleAfterSeconds })
    .from(integrationConnections)
    .where(eq(integrationConnections.partnerOrgId, orgId));
  return {
    connections: conns,
    mappings: can(actor, "partner.catalogue.read", { organizationId: orgId }) ? await partnerMappings(db, orgId) : [],
    fulfilment: can(actor, "partner.orders.read", { organizationId: orgId }) ? await partnerFulfilmentRequests(db, orgId) : [],
    events: await partnerRecentEvents(db, orgId),
  };
}
