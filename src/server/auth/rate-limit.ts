import { sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { rateLimits } from "../db/schema";
import { AppError } from "../lib/errors";

/**
 * Fixed-window counter stored in Postgres, so limits hold across processes.
 * Returns true when the call is allowed.
 */
export async function hit(db: DB, key: string, limit: number, windowSeconds: number, now = new Date()) {
  const windowStartCutoff = new Date(now.getTime() - windowSeconds * 1000);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStart} < ${windowStartCutoff} THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${rateLimits.windowStart} < ${windowStartCutoff} THEN ${now} ELSE ${rateLimits.windowStart} END`,
      },
    })
    .returning({ count: rateLimits.count });
  return (row?.count ?? 1) <= limit;
}

export async function enforce(db: DB, key: string, limit: number, windowSeconds: number) {
  if (!(await hit(db, key, limit, windowSeconds))) {
    throw new AppError("rate_limited", "Too many attempts. Please wait a few minutes and try again.");
  }
}
