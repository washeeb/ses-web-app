import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

/**
 * Event bus feeding Server-Sent Events. Events are published only after the database commit that caused them.
 * Within one process they go straight to local listeners. With PostgreSQL, a transport (event-bus-pg.ts) also
 * relays them through LISTEN/NOTIFY so every app process — several Passenger workers, or several servers — sees them.
 */
export interface LiveEvent {
  topic: "catalogue" | "stock" | "orders" | "quotes" | "approvals" | "integrations" | "leads" | "returns" | "notifications" | "invoices" | "subscriptions" | "tickets" | "projects" | "assets";
  /** Organisations allowed to receive the event in addition to operator staff. */
  orgIds?: string[];
  data?: Record<string, unknown>;
  at?: string;
}

/** What travels between processes. `origin` lets a process ignore its own echo. */
export interface WireEvent {
  origin: string;
  event: LiveEvent;
}

const g = globalThis as unknown as { __sesBus?: EventEmitter; __sesInstance?: string; __sesTransport?: ((w: WireEvent) => void) | null };
const bus = (g.__sesBus ??= new EventEmitter().setMaxListeners(1000));
export const INSTANCE_ID = (g.__sesInstance ??= randomUUID());

function emitLocal(event: LiveEvent) {
  bus.emit("event", event);
}

export function publish(event: LiveEvent) {
  const e = { ...event, at: event.at ?? new Date().toISOString() };
  emitLocal(e);
  g.__sesTransport?.({ origin: INSTANCE_ID, event: e });
}

/** Installed by a cross-process transport; `null` removes it. */
export function setTransport(send: ((w: WireEvent) => void) | null) {
  g.__sesTransport = send;
}

/** Called by a transport for each message it receives from any process. Returns true if delivered locally. */
export function receiveRemote(raw: string, self = INSTANCE_ID): boolean {
  let w: WireEvent;
  try {
    w = JSON.parse(raw) as WireEvent;
  } catch {
    return false;
  }
  if (!w || typeof w.origin !== "string" || w.origin === self || !w.event || typeof w.event.topic !== "string") return false;
  emitLocal({ topic: w.event.topic, orgIds: Array.isArray(w.event.orgIds) ? w.event.orgIds.filter((x) => typeof x === "string") : undefined, at: w.event.at });
  return true;
}

export function subscribe(listener: (e: LiveEvent) => void) {
  bus.on("event", listener);
  return () => bus.off("event", listener);
}
