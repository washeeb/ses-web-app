import { getDb } from "@/server/db/client";
import { safeEqual } from "@/server/lib/crypto";
import { tick } from "@/server/worker";

export const dynamic = "force-dynamic";

const g = globalThis as unknown as { __sesCronRunning?: boolean };

/**
 * Runs one pass of the background job queue. For shared hosting, where the app process may be
 * stopped when idle: schedule a cPanel cron job to call this every few minutes with
 *   Authorization: Bearer $CRON_SECRET
 * Safe to call alongside the inline worker: jobs are claimed with row locks (SKIP LOCKED).
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  if (secret.length < 24 || !safeEqual(given, secret)) return new Response(null, { status: 401 });
  if (g.__sesCronRunning) return Response.json({ status: "busy" });
  g.__sesCronRunning = true;
  try {
    const r = await tick(getDb());
    return Response.json({ status: "ok", ...r });
  } finally {
    g.__sesCronRunning = false;
  }
}

export const GET = handle;
export const POST = handle;
