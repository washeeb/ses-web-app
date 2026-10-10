import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { actorFor, setupDb, SIM_SECRET } from "./helpers";
import type { DB } from "@/server/db/client";
import {
  approvalRequests,
  inboundEvents,
  integrationConnections,
  jobs,
  orderLines,
  organizations,
  productMappings,
  products,
  productVariants,
  stockLevels,
} from "@/server/db/schema";
import { receiveWebhook } from "@/server/modules/integrations/inbound";
import { signPayload, verifySignature } from "@/server/modules/integrations/contracts";
import { authenticateApiKey, createApiKey, createConnection, partnerFulfilmentRequests, partnerMappings, replayEvent } from "@/server/modules/integrations/manage";
import { deliverOutbound } from "@/server/modules/integrations/outbound";
import { backoffMs, runDueJobs } from "@/server/modules/jobs";
import { JOB_HANDLERS, tick } from "@/server/worker";
import { KingsViewSimulator, SIM_CATALOGUE } from "@/simulators/kingsview/simulator";
import { listStoreProducts, updateProduct } from "@/server/modules/catalogue";
import { computeAvailability } from "@/server/modules/inventory";
import { acceptQuote, confirmOrder, createQuote, sendQuote, submitQuote } from "@/server/modules/sales";
import { decideApproval } from "@/server/modules/approvals";

let db: DB;
let close: () => Promise<void>;
let orgs: Awaited<ReturnType<typeof setupDb>>["organizations"];
let connId: string;
let sim: KingsViewSimulator;
let clockMs = Date.now();

beforeAll(async () => {
  ({ db, close, organizations: orgs } = await setupDb());
  const [conn] = await db.select().from(integrationConnections).where(eq(integrationConnections.mode, "simulator"));
  connId = conn!.id;
  sim = new KingsViewSimulator(
    SIM_SECRET,
    (rawBody, sig) => receiveWebhook(db, { connectionId: connId, rawBody, headers: { "ses-signature": sig } }, new Date(clockMs)),
    () => clockMs,
  );
});
afterAll(() => close());

/** Process everything queued, as the worker would. */
const drain = async () => {
  for (let i = 0; i < 10; i++) {
    const r = await runDueJobs(db, JOB_HANDLERS, { now: new Date(clockMs + 365 * 86_400_000), limit: 100 });
    if (r.done + r.retried + r.dead === 0) break;
  }
};
const mapping = async (sku: string) =>
  (await db.select().from(productMappings).where(and(eq(productMappings.connectionId, connId), eq(productMappings.partnerSku, sku))))[0]!;

describe("signatures", () => {
  it("accepts valid, rejects tampered, expired and malformed", () => {
    const body = '{"a":1}';
    const now = 1_800_000_000;
    expect(verifySignature("s", body, signPayload("s", body, now), now)).toBe("ok");
    expect(verifySignature("s", body + " ", signPayload("s", body, now), now)).toBe("mismatch");
    expect(verifySignature("s", body, signPayload("s", body, now - 301), now)).toBe("expired");
    expect(verifySignature("s", body, "garbage", now)).toBe("malformed");
    expect(verifySignature("s", body, null, now)).toBe("missing");
  });
});

describe("KingsView simulator contract", () => {
  it("initial sync creates DRAFT products (never auto-published) with mapped stock", async () => {
    const results = await sim.initialSync();
    expect(results.every((r) => r.status === 202)).toBe(true);
    await drain();
    const m = await mapping(SIM_CATALOGUE[0].sku);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, m.variantId));
    expect(v!.priceMinor).toBe(540_000); // 450,000 cost + 20% default markup
    const [p] = await db.select().from(products).where(eq(products.id, v!.productId));
    expect(p!.status).toBe("draft");
    expect(p!.isDemo).toBe(true);
    expect((await listStoreProducts(db)).some((x) => x.id === p!.id)).toBe(false);
    const [lvl] = await db.select().from(stockLevels).where(eq(stockLevels.variantId, v!.id));
    expect(lvl!.onHand).toBe(SIM_CATALOGUE[0].stock);
  });

  it("acknowledges duplicates without reprocessing", async () => {
    clockMs += 1000;
    const first = await sim.stock(SIM_CATALOGUE[1].sku, 6);
    const dup = await sim.duplicateLast();
    expect(first.status).toBe(202);
    expect(dup.status).toBe(200);
    expect(dup.body).toMatchObject({ status: "duplicate" });
    const rows = await db.select().from(inboundEvents).where(eq(inboundEvents.eventId, first.id));
    expect(rows).toHaveLength(1);
    const queued = await db.select().from(jobs).where(eq(jobs.dedupeKey, `inbound:${rows[0]!.id}`));
    expect(queued).toHaveLength(1);
    await drain();
  });

  it("ignores out-of-date versions", async () => {
    const stale = await sim.staleStock(SIM_CATALOGUE[1].sku, 500);
    await drain();
    const [ev] = await db.select().from(inboundEvents).where(eq(inboundEvents.eventId, stale.id));
    expect(ev!.status).toBe("stale_ignored");
    const m = await mapping(SIM_CATALOGUE[1].sku);
    const [lvl] = await db.select().from(stockLevels).where(eq(stockLevels.variantId, m.variantId));
    expect(lvl!.onHand).toBe(6);
  });

  it("rejects bad signatures and replayed (old) requests", async () => {
    expect((await sim.badSignature()).status).toBe(401);
    expect((await sim.replayOld()).status).toBe(401);
    expect((await receiveWebhook(db, { connectionId: connId, rawBody: "{}", headers: {} })).status).toBe(401);
    expect((await receiveWebhook(db, { connectionId: "not-a-uuid", rawBody: "{}", headers: {} })).status).toBe(404);
  });

  it("rejects malformed payloads with 400", async () => {
    const body = JSON.stringify({ id: "evt_bad_payload_1", type: "stock.updated", occurred_at: new Date().toISOString(), version: 5, data: { sku: "X", on_hand: -1 } });
    const res = await receiveWebhook(db, { connectionId: connId, rawBody: body, headers: { "ses-signature": signPayload(SIM_SECRET, body, Math.floor(clockMs / 1000)) } }, new Date(clockMs));
    expect(res.status).toBe(400);
  });

  it("retries events that arrive before their product, then succeeds", async () => {
    clockMs += 1000;
    const [stockFirst] = await sim.outOfOrder("SIM-KV-LATE-1");
    // First pass: the stock event's job fails (unknown SKU) and is rescheduled with backoff.
    await runDueJobs(db, JOB_HANDLERS, { now: new Date(Date.now() + 1000) });
    const [ev1] = await db.select().from(inboundEvents).where(eq(inboundEvents.eventId, stockFirst!.id));
    expect(["failed", "processed"]).toContain(ev1!.status);
    await drain();
    const [ev2] = await db.select().from(inboundEvents).where(eq(inboundEvents.eventId, stockFirst!.id));
    expect(ev2!.status).toBe("processed");
  });

  it("holds large partner price rises for approval and applies small ones", async () => {
    const sku = SIM_CATALOGUE[2].sku; // cost 95,000 → price 114,000
    clockMs += 1000;
    await sim.priceChange(sku, 100_000); // +5.3%
    await drain();
    const m = await mapping(sku);
    expect((await db.select().from(productVariants).where(eq(productVariants.id, m.variantId)))[0]!.priceMinor).toBe(120_000);
    clockMs += 1000;
    await sim.priceChange(sku, 150_000); // +50%
    await drain();
    expect((await db.select().from(productVariants).where(eq(productVariants.id, m.variantId)))[0]!.priceMinor).toBe(120_000);
    const [req] = await db.select().from(approvalRequests).where(and(eq(approvalRequests.subjectId, m.variantId), eq(approvalRequests.status, "pending")));
    expect(req!.requestedBy).toBeNull();
    await decideApproval(db, await actorFor(db, "finance@ses.demo"), req!.id, true, "Matches supplier notice");
    expect((await db.select().from(productVariants).where(eq(productVariants.id, m.variantId)))[0]!.priceMinor).toBe(180_000);
  });
});

describe("stale-data safeguards", () => {
  it("partner stock older than the window is unconfirmed and not purchasable", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const fresh = { onHand: 5, reserved: 0, sourceUpdatedAt: new Date(now.getTime() - 60_000), staleAfterSeconds: 900 };
    const stale = { ...fresh, sourceUpdatedAt: new Date(now.getTime() - 3_600_000) };
    expect(computeAvailability([fresh], true, now)).toMatchObject({ status: "in_stock", purchasable: true });
    expect(computeAvailability([stale], true, now)).toMatchObject({ status: "unconfirmed", purchasable: false, stale: true });
    expect(computeAvailability([{ ...stale, staleAfterSeconds: null }], true, now).status).toBe("in_stock"); // SES stock never stale
  });
});

describe("partner isolation", () => {
  it("one partner cannot update another partner's order lines and sees only its own data", async () => {
    // Publish a simulated product and sell it so a line is assigned to KingsView.
    const m = await mapping(SIM_CATALOGUE[0].sku);
    const [v] = await db.select().from(productVariants).where(eq(productVariants.id, m.variantId));
    const proc = await actorFor(db, "procurement@ses.demo");
    const [p] = await db.select().from(products).where(eq(products.id, v!.productId));
    await updateProduct(db, proc, p!.id, { name: p!.name, type: p!.type, status: "active", summary: "", description: "" });
    const sales = await actorFor(db, "sales@ses.demo");
    const q = await createQuote(db, sales, { customerOrgId: orgs.custA.id, discountBp: 0, lines: [{ variantId: v!.id, quantity: 1 }] });
    await submitQuote(db, sales, q.id);
    await sendQuote(db, sales, q.id);
    // Keep partner stock fresh relative to real time for the reservation.
    clockMs = Date.now();
    await sim.stock(SIM_CATALOGUE[0].sku, 12);
    await drain();
    const order = await acceptQuote(db, await actorFor(db, "buyer.admin@customer-a.demo"), q.id);
    await confirmOrder(db, await actorFor(db, "warehouse@ses.demo"), order.id);
    const [line] = await db.select().from(orderLines).where(eq(orderLines.orderId, order.id));
    expect(line!.fulfilmentConnectionId).toBe(connId);
    expect(line!.fulfilmentStatus).toBe("requested");

    // A second, unrelated partner with its own connection.
    const [other] = await db.insert(organizations).values({ type: "partner", name: "Other Partner (test)", slug: "other-partner" }).returning();
    const created = await createConnection(db, await actorFor(db, "integrations@ses.demo"), { partnerOrgId: other!.id, name: "Other (SIMULATOR)", mode: "simulator" });
    const otherSim = new KingsViewSimulator(created.inboundSecret, (rawBody, sig) => receiveWebhook(db, { connectionId: created.connection.id, rawBody, headers: { "ses-signature": sig } }));
    const attempt = await otherSim.fulfilment(order.number, "delivered");
    expect(attempt.status).toBe(202);
    await drain();
    const [ev] = await db.select().from(inboundEvents).where(eq(inboundEvents.eventId, attempt.id));
    expect(ev!.status).toBe("rejected");
    expect((await db.select().from(orderLines).where(eq(orderLines.id, line!.id)))[0]!.fulfilmentStatus).toBe("requested");
    // Using the other partner's secret against KingsView's connection fails signature checks.
    const forged = await new KingsViewSimulator(created.inboundSecret, (rawBody, sig) => receiveWebhook(db, { connectionId: connId, rawBody, headers: { "ses-signature": sig } })).fulfilment(order.number, "delivered");
    expect(forged.status).toBe(401);

    // The rightful partner can update it.
    await sim.fulfilment(order.number, "shipped");
    await drain();
    expect((await db.select().from(orderLines).where(eq(orderLines.id, line!.id)))[0]!.fulfilmentStatus).toBe("shipped");

    expect(await partnerFulfilmentRequests(db, other!.id)).toEqual([]);
    expect(await partnerMappings(db, other!.id)).toEqual([]);
    const kvMaps = await partnerMappings(db, orgs.kingsview.id);
    expect(kvMaps.length).toBeGreaterThan(0);
    expect(Object.keys(kvMaps[0]!)).not.toContain("priceMinor"); // SES sell price is not exposed to partners
  });
});

describe("API keys", () => {
  it("authenticates with scopes, rejects revoked/foreign/malformed keys", async () => {
    const admin = await actorFor(db, "integrations@ses.demo");
    const { key } = await createApiKey(db, admin, { connectionId: connId, name: "test key", scopes: ["catalogue:read"] });
    const ok = await authenticateApiKey(db, `Bearer ${key}`, "catalogue:read");
    expect(ok).toMatchObject({ ok: true, organizationId: orgs.kingsview.id });
    expect(await authenticateApiKey(db, `Bearer ${key}`, "orders:read")).toMatchObject({ ok: false, status: 403 });
    expect(await authenticateApiKey(db, `Bearer ${key.slice(0, -2)}xx`, "catalogue:read")).toMatchObject({ ok: false, status: 401 });
    expect(await authenticateApiKey(db, "Basic abc", "catalogue:read")).toMatchObject({ ok: false, status: 401 });
    await expect(createApiKey(db, await actorFor(db, "integrations@ses.demo", false), { connectionId: connId, name: "x key", scopes: ["catalogue:read"] })).rejects.toMatchObject({ code: "mfa_required" });
  });
});

describe("outbound delivery, retries and dead-letter", () => {
  it("signs outbound events, retries with backoff and dead-letters after max attempts", async () => {
    expect(backoffMs(1, () => 0.5)).toBe(30_000);
    expect(backoffMs(2, () => 0.5)).toBe(120_000);
    expect(backoffMs(20, () => 0.5)).toBe(6 * 3_600_000);

    const delivered: { url: string; sig: string; body: string }[] = [];
    const okFetch = async (url: string, init: { headers: Record<string, string>; body: string }) => {
      delivered.push({ url, sig: init.headers["ses-signature"]!, body: init.body });
      return { ok: true, status: 200 };
    };
    const [job] = await db.select().from(jobs).where(eq(jobs.type, "integration.outbound.deliver"));
    expect(job).toBeTruthy();
    await deliverOutbound(db, job!.payload as Record<string, unknown>, job!, okFetch);
    expect(delivered[0]!.url).toMatch(/\/api\/simulators\/kingsview\/inbox$/);
    expect(JSON.parse(delivered[0]!.body)).toMatchObject({ type: "order.fulfilment_requested" });

    // A failing handler is retried, then dead-lettered.
    await db.insert(jobs).values({ type: "test.always_fails", maxAttempts: 3 });
    const failing = { "test.always_fails": async () => { throw new Error("partner down"); } };
    let now = Date.now();
    const statuses: string[] = [];
    for (let i = 0; i < 3; i++) {
      now += 7 * 3_600_000;
      await runDueJobs(db, failing, { now: new Date(now) });
      const [j] = await db.select().from(jobs).where(eq(jobs.type, "test.always_fails"));
      statuses.push(`${j!.status}:${j!.attempts}`);
    }
    expect(statuses).toEqual(["queued:1", "queued:2", "dead:3"]);
  });

  it("dead-lettered inbound events can be replayed by an integration manager", async () => {
    const body = JSON.stringify({ id: "evt_never_mapped_1", type: "price.updated", occurred_at: new Date().toISOString(), version: 1, data: { sku: "SIM-NEVER", cost: { amount_minor: 1, currency: "GHS" } } });
    const res = await receiveWebhook(db, { connectionId: connId, rawBody: body, headers: { "ses-signature": signPayload(SIM_SECRET, body) } });
    expect(res.status).toBe(202);
    const [ev] = await db.select().from(inboundEvents).where(eq(inboundEvents.eventId, "evt_never_mapped_1"));
    await db.update(jobs).set({ maxAttempts: 1 }).where(eq(jobs.dedupeKey, `inbound:${ev!.id}`));
    await tick(db);
    const [dead] = await db.select().from(inboundEvents).where(eq(inboundEvents.id, ev!.id));
    expect(dead!.status).toBe("dead");
    await expect(replayEvent(db, await actorFor(db, "auditor@ses.demo"), ev!.id)).rejects.toMatchObject({ code: "forbidden" });
    await replayEvent(db, await actorFor(db, "integrations@ses.demo"), ev!.id);
    expect((await db.select().from(inboundEvents).where(eq(inboundEvents.id, ev!.id)))[0]!.status).toBe("received");
  });
});
