import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { jobs } from "../db/schema";
import { log } from "../lib/log";

export type JobRow = typeof jobs.$inferSelect;
export type JobHandler = (db: DB, payload: Record<string, unknown>, job: JobRow) => Promise<void>;
export interface JobHandlers {
  [type: string]: JobHandler;
}
/** Called once a job has exhausted its attempts (dead-letter). */
export type DeadLetterHook = (db: DB, job: JobRow, error: string) => Promise<void>;

export async function enqueue(
  db: DB,
  job: { type: string; payload?: Record<string, unknown>; runAt?: Date; dedupeKey?: string; maxAttempts?: number },
) {
  const [row] = await db
    .insert(jobs)
    .values({
      type: job.type,
      payload: job.payload ?? {},
      runAt: job.runAt ?? new Date(),
      dedupeKey: job.dedupeKey ?? null,
      maxAttempts: job.maxAttempts ?? 8,
    })
    .onConflictDoNothing({ target: jobs.dedupeKey })
    .returning();
  return row ?? null;
}

/** 30s, 2m, 8m, 32m, ~2h, capped at 6h, with ±20% jitter. */
export function backoffMs(attempt: number, random = Math.random) {
  const base = Math.min(30_000 * 4 ** Math.max(0, attempt - 1), 6 * 60 * 60 * 1000);
  return Math.round(base * (0.8 + random() * 0.4));
}

const STUCK_AFTER_MS = 10 * 60 * 1000;

export async function runDueJobs(
  db: DB,
  handlers: JobHandlers,
  opts: { limit?: number; now?: Date; onDead?: DeadLetterHook } = {},
) {
  const now = opts.now ?? new Date();
  // Recover jobs whose worker died mid-run.
  await db
    .update(jobs)
    .set({ status: "queued", lockedAt: null })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, new Date(now.getTime() - STUCK_AFTER_MS))));

  const claimed = await db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "queued"), lte(jobs.runAt, now)))
      .orderBy(asc(jobs.runAt))
      .limit(opts.limit ?? 20)
      .for("update", { skipLocked: true });
    if (due.length === 0) return [];
    await tx
      .update(jobs)
      .set({ status: "running", lockedAt: now })
      .where(inArray(jobs.id, due.map((j) => j.id)));
    return due;
  });

  const results = { done: 0, retried: 0, dead: 0 };
  for (const job of claimed) {
    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`No handler for job type "${job.type}"`);
      await handler(db, job.payload as Record<string, unknown>, job);
      await db.update(jobs).set({ status: "done", attempts: job.attempts + 1, completedAt: new Date(), lockedAt: null, lastError: null }).where(eq(jobs.id, job.id));
      results.done++;
    } catch (err) {
      const attempts = job.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      const dead = attempts >= job.maxAttempts;
      await db
        .update(jobs)
        .set({
          status: dead ? "dead" : "queued",
          attempts,
          lastError: message.slice(0, 2000),
          lockedAt: null,
          runAt: dead ? job.runAt : new Date(now.getTime() + backoffMs(attempts)),
        })
        .where(eq(jobs.id, job.id));
      log.warn("job.failed", { jobId: job.id, type: job.type, attempts, dead, error: message });
      if (dead) {
        results.dead++;
        await opts.onDead?.(db, { ...job, attempts }, message);
      } else results.retried++;
    }
  }
  return results;
}

/** Put a dead-lettered job back on the queue (manual replay). */
export async function requeueJob(db: DB, jobId: string) {
  await db
    .update(jobs)
    .set({ status: "queued", attempts: 0, runAt: new Date(), lastError: null })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "dead")));
}

export async function jobStats(db: DB) {
  const rows = await db
    .select({ status: jobs.status, n: sql<number>`count(*)::int` })
    .from(jobs)
    .groupBy(jobs.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<string, number>;
}
