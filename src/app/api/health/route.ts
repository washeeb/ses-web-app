import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { jobStats } from "@/server/modules/jobs";

export const dynamic = "force-dynamic";

/** Liveness + readiness: database round-trip and queue state. No sensitive data. */
export async function GET() {
  const started = Date.now();
  try {
    const db = getDb();
    await db.execute(sql`select 1`);
    const jobs = await jobStats(db);
    return Response.json({ status: "ok", dbLatencyMs: Date.now() - started, jobs: { queued: jobs.queued ?? 0, running: jobs.running ?? 0, dead: jobs.dead ?? 0 } });
  } catch {
    return Response.json({ status: "error" }, { status: 503 });
  }
}
