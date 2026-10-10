import { EventEmitter } from "node:events";

/**
 * In-process event bus feeding Server-Sent Events.
 * Events are published only after the database commit that caused them.
 * Multi-instance deployments need a Postgres LISTEN/NOTIFY transport (plan M4).
 */
export interface LiveEvent {
  topic: "catalogue" | "stock" | "orders" | "quotes" | "approvals" | "integrations" | "leads" | "returns" | "notifications" | "invoices";
  /** Organisations allowed to receive the event in addition to operator staff. */
  orgIds?: string[];
  data?: Record<string, unknown>;
  at?: string;
}

const g = globalThis as unknown as { __sesBus?: EventEmitter };
const bus = (g.__sesBus ??= new EventEmitter().setMaxListeners(1000));

export function publish(event: LiveEvent) {
  bus.emit("event", { ...event, at: event.at ?? new Date().toISOString() });
}

export function subscribe(listener: (e: LiveEvent) => void) {
  bus.on("event", listener);
  return () => bus.off("event", listener);
}
