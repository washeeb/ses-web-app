import { getSessionState } from "@/server/web/session";
import { subscribe, type LiveEvent } from "@/server/modules/events";

export const dynamic = "force-dynamic";

const PUBLIC_TOPICS = new Set(["catalogue", "stock"]);

/**
 * Server-Sent Events. Signed-in operator staff receive all topics they ask for; customers and partners
 * only receive events addressed to their organisation. Anonymous visitors get catalogue/stock pings only.
 * Payloads are hints to refresh — data is always re-read through permission-checked queries.
 */
export async function GET(req: Request) {
  const state = await getSessionState();
  const actor = state && !state.pending ? state.actor : null;
  const wanted = new Set((new URL(req.url).searchParams.get("topics") ?? "").split(",").filter(Boolean).slice(0, 10));

  const allowed = (e: LiveEvent) => {
    if (wanted.size && !wanted.has(e.topic)) return false;
    if (!actor) return PUBLIC_TOPICS.has(e.topic) && !e.orgIds?.length;
    if (actor.organizationType === "operator") return true;
    return PUBLIC_TOPICS.has(e.topic) || (e.orgIds ?? []).includes(actor.organizationId);
  };

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      send(`retry: 5000\n: connected\n\n`);
      const unsubscribe = subscribe((e) => {
        if (allowed(e)) send(`data: ${JSON.stringify({ topic: e.topic, at: e.at })}\n\n`);
      });
      const heartbeat = setInterval(() => send(`: ping\n\n`), 25_000);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
}
