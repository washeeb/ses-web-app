import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import { integrationConnections, orderLines, orders } from "@/server/db/schema";
import { authorize, type Actor } from "@/server/authz/policy";
import { decryptSecret } from "@/server/lib/crypto";
import { invalid, notFound } from "@/server/lib/errors";
import { audit } from "@/server/modules/audit";
import { receiveWebhook } from "@/server/modules/integrations/inbound";
import { KingsViewSimulator, SIM_CATALOGUE, type SentEvent } from "./simulator";

export const SCENARIOS = {
  initial: "Initial catalogue sync (5 simulated items + stock)",
  stock_random: "Random stock change on one item",
  price_small: "Small cost change (+5%) on one item",
  price_large: "Large cost change (+40%) — needs approval",
  faults: "Fault injection: duplicate, stale version, bad signature, replay, out-of-order",
  ack_orders: "Accept all pending fulfilment requests",
  ship_orders: "Mark accepted requests as shipped",
  deliver_orders: "Mark shipped requests as delivered",
} as const;
export type Scenario = keyof typeof SCENARIOS;

/**
 * Runs a simulator scenario in-process through the same verification path as the HTTP endpoint.
 * Only for simulator-mode connections, and only when SIMULATORS_ENABLED=true.
 */
export async function runScenario(db: DB, actor: Actor, connectionId: string, scenario: Scenario): Promise<SentEvent[]> {
  authorize(actor, "integrations.manage");
  if (process.env.SIMULATORS_ENABLED !== "true") throw invalid("Simulators are disabled in this environment.");
  const [conn] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, connectionId));
  if (!conn) throw notFound("Connection not found.");
  if (conn.mode !== "simulator") throw invalid("Simulator scenarios can only target simulator connections.");

  const sim = new KingsViewSimulator(decryptSecret(conn.inboundSecretEnc), (rawBody, sig) =>
    receiveWebhook(db, { connectionId, rawBody, headers: { "ses-signature": sig } }),
  );
  const pick = () => SIM_CATALOGUE[Math.floor(Math.random() * SIM_CATALOGUE.length)]!;
  let results: SentEvent[];
  switch (scenario) {
    case "initial":
      results = await sim.initialSync();
      break;
    case "stock_random": {
      const item = pick();
      results = [await sim.stock(item.sku, Math.floor(Math.random() * 25))];
      break;
    }
    case "price_small": {
      const item = pick();
      results = [await sim.priceChange(item.sku, Math.round(item.costMinor * 1.05))];
      break;
    }
    case "price_large": {
      const item = pick();
      results = [await sim.priceChange(item.sku, Math.round(item.costMinor * 1.4))];
      break;
    }
    case "faults":
      results = [
        await sim.stock(SIM_CATALOGUE[1].sku, 6),
        await sim.duplicateLast(),
        await sim.staleStock(SIM_CATALOGUE[1].sku, 500),
        await sim.badSignature(),
        await sim.replayOld(),
        ...(await sim.outOfOrder()),
      ];
      break;
    default: {
      const from = { ack_orders: "requested", ship_orders: "accepted", deliver_orders: "shipped" }[scenario];
      const to = ({ ack_orders: "accepted", ship_orders: "shipped", deliver_orders: "delivered" } as const)[scenario];
      const lines = await db
        .select({ orderNumber: orders.number, lineId: orderLines.id })
        .from(orderLines)
        .innerJoin(orders, eq(orders.id, orderLines.orderId))
        .where(and(eq(orderLines.fulfilmentConnectionId, connectionId), eq(orderLines.fulfilmentStatus, from), inArray(orders.status, ["confirmed"])));
      results = [];
      for (const l of lines) results.push(await sim.fulfilment(l.orderNumber, to, l.lineId));
    }
  }
  await audit(db, { actor, action: "simulator.scenario_run", targetType: "connection", targetId: connectionId, data: { scenario, events: results.length } });
  return results;
}
