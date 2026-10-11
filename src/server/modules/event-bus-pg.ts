import pg from "pg";
import { log } from "../lib/log";
import { receiveRemote, setTransport, type WireEvent } from "./events";

/**
 * Relays live events between app processes with PostgreSQL LISTEN/NOTIFY. One dedicated connection per process
 * listens; notifications are sent on the same connection. If the connection drops, events still reach this
 * process's own users and the relay reconnects with back-off.
 */
const CHANNEL = "ses_events";
const MAX_PAYLOAD = 7_900; // NOTIFY payloads must stay under 8,000 bytes

const g = globalThis as unknown as { __sesPgBus?: boolean };

export function startPgEventBus(connectionString: string) {
  if (g.__sesPgBus) return;
  g.__sesPgBus = true;
  let client: pg.Client | null = null;
  let delay = 1_000;

  const send = (w: WireEvent) => {
    const payload = JSON.stringify(w);
    if (!client || Buffer.byteLength(payload) > MAX_PAYLOAD) return;
    client.query("SELECT pg_notify($1, $2)", [CHANNEL, payload]).catch((err: Error) => log.warn("eventbus.notify_failed", { error: err.message }));
  };

  const connect = async () => {
    const c = new pg.Client({ connectionString });
    c.on("notification", (msg) => {
      if (msg.channel === CHANNEL && msg.payload) receiveRemote(msg.payload);
    });
    c.on("error", (err) => {
      log.warn("eventbus.connection_error", { error: err.message });
      retry();
    });
    try {
      await c.connect();
      await c.query(`LISTEN ${CHANNEL}`);
      client = c;
      delay = 1_000;
      setTransport(send);
      log.info("eventbus.listening", { channel: CHANNEL });
    } catch (err) {
      log.warn("eventbus.connect_failed", { error: err instanceof Error ? err.message : String(err) });
      c.end().catch(() => {});
      retry();
    }
  };

  const retry = () => {
    setTransport(null);
    const old = client;
    client = null;
    old?.end().catch(() => {});
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 60_000);
  };

  void connect();
}
