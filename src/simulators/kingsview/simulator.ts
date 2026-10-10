import { randomUUID } from "node:crypto";
import { signPayload, type InboundEventType } from "@/server/modules/integrations/contracts";

/**
 * KingsView Solutions — SIMULATOR.
 *
 * KingsView's web application does not exist yet. This simulator only exercises SES's own
 * integration contract (v1) with obviously fictional data. It does not represent KingsView's
 * real catalogue, prices, stock, API or commercial terms.
 */
export const SIMULATOR_NOTICE = "Simulated partner data — not real KingsView Solutions products, prices or stock.";

export const SIM_CATALOGUE = [
  { sku: "SIM-KV-RTR-001", name: "Simulated item: Enterprise router", type: "hardware", costMinor: 450_000, stock: 12 },
  { sku: "SIM-KV-SW-024", name: "Simulated item: 24-port managed switch", type: "hardware", costMinor: 320_000, stock: 7 },
  { sku: "SIM-KV-AP-002", name: "Simulated item: Wi-Fi 6 access point", type: "hardware", costMinor: 95_000, stock: 30 },
  { sku: "SIM-KV-UPS-15", name: "Simulated item: 1.5 kVA UPS", type: "hardware", costMinor: 210_000, stock: 2 },
  { sku: "SIM-KV-FW-100", name: "Simulated item: Next-gen firewall appliance", type: "hardware", costMinor: 1_150_000, stock: 0 },
] as const;

export type Sender = (rawBody: string, signatureHeader: string) => Promise<{ status: number; body: unknown }>;

export interface SentEvent {
  label: string;
  type: string;
  id: string;
  status: number;
  body: unknown;
}

export class KingsViewSimulator {
  private lastVersion = 0;
  private last: { rawBody: string } | null = null;

  constructor(
    private readonly secret: string,
    private readonly send: Sender,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Monotonic across restarts because it is based on wall-clock milliseconds. */
  private nextVersion() {
    this.lastVersion = Math.max(this.lastVersion + 1, this.clock());
    return this.lastVersion;
  }

  build(type: InboundEventType, data: Record<string, unknown>, opts: { version?: number; id?: string } = {}) {
    return JSON.stringify({
      id: opts.id ?? `evt_sim_${randomUUID()}`,
      type,
      occurred_at: new Date(this.clock()).toISOString(),
      version: opts.version ?? this.nextVersion(),
      data,
    });
  }

  async emit(label: string, type: InboundEventType, data: Record<string, unknown>, opts: { version?: number; id?: string; signWith?: string; timestampSec?: number } = {}): Promise<SentEvent> {
    const rawBody = this.build(type, data, opts);
    this.last = { rawBody };
    const sig = signPayload(opts.signWith ?? this.secret, rawBody, opts.timestampSec ?? Math.floor(this.clock() / 1000));
    const res = await this.send(rawBody, sig);
    return { label, type, id: JSON.parse(rawBody).id, ...res };
  }

  async initialSync() {
    const out: SentEvent[] = [];
    for (const item of SIM_CATALOGUE) {
      out.push(
        await this.emit(`upsert ${item.sku}`, "product.upserted", {
          sku: item.sku,
          name: item.name,
          description: `${SIMULATOR_NOTICE} Used to test the SES integration pipeline.`,
          product_type: item.type,
          active: true,
          cost: { amount_minor: item.costMinor, currency: "GHS" },
        }),
      );
      out.push(await this.emit(`stock ${item.sku}`, "stock.updated", { sku: item.sku, on_hand: item.stock, location: "main" }));
    }
    return out;
  }

  priceChange(sku: string, costMinor: number) {
    return this.emit(`price ${sku} → ${costMinor}`, "price.updated", { sku, cost: { amount_minor: costMinor, currency: "GHS" } });
  }

  stock(sku: string, onHand: number) {
    return this.emit(`stock ${sku} = ${onHand}`, "stock.updated", { sku, on_hand: onHand, location: "main" });
  }

  fulfilment(orderNumber: string, status: "accepted" | "rejected" | "shipped" | "delivered", lineId?: string) {
    return this.emit(`fulfilment ${orderNumber} ${status}`, "fulfilment.updated", { order_number: orderNumber, status, ...(lineId ? { line_id: lineId } : {}) });
  }

  // ── Fault injection ──

  /** Re-sends the exact previous body: must be acknowledged as a duplicate. */
  async duplicateLast(): Promise<SentEvent> {
    if (!this.last) throw new Error("Nothing sent yet");
    const sig = signPayload(this.secret, this.last.rawBody, Math.floor(this.clock() / 1000));
    const res = await this.send(this.last.rawBody, sig);
    return { label: "duplicate of previous event", type: JSON.parse(this.last.rawBody).type, id: JSON.parse(this.last.rawBody).id, ...res };
  }

  /** An older version arriving late: must be ignored as stale. */
  staleStock(sku: string, onHand: number) {
    return this.emit(`stale stock ${sku} = ${onHand}`, "stock.updated", { sku, on_hand: onHand, location: "main" }, { version: 1 });
  }

  /** Signed with the wrong secret: must be rejected with 401. */
  badSignature() {
    return this.emit("bad signature", "stock.updated", { sku: SIM_CATALOGUE[0].sku, on_hand: 999 }, { signWith: "whsec_wrong_secret" });
  }

  /** Valid signature but 10 minutes old (replay): must be rejected with 401. */
  replayOld() {
    return this.emit("replayed (old timestamp)", "stock.updated", { sku: SIM_CATALOGUE[0].sku, on_hand: 999 }, { timestampSec: Math.floor(this.clock() / 1000) - 600 });
  }

  /** Stock for a SKU that has not been announced yet: retried until the product arrives. */
  async outOfOrder(sku = `SIM-KV-LATE-${Math.floor(this.clock() / 1000) % 100000}`) {
    const first = await this.emit(`stock before product ${sku}`, "stock.updated", { sku, on_hand: 5, location: "main" });
    const second = await this.emit(`product after stock ${sku}`, "product.upserted", {
      sku,
      name: "Simulated item: Late-announced cable kit",
      active: true,
      cost: { amount_minor: 15_000, currency: "GHS" },
    });
    return [first, second];
  }
}
