import { and, eq, isNotNull, lt, or } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { uploadRoot } from "./documents";
import type { DB } from "../db/client";
import { documents, jobs, mailOutbox, passwordResetTokens, rateLimits, sessions } from "../db/schema";
import { log } from "../lib/log";

const DAY = 86_400_000;

/**
 * Retention clean-up, run hourly by the worker. Removes data that has no further use:
 * expired/revoked sessions (30 d), old rate-limit windows (1 d), used/expired reset tokens (7 d),
 * completed jobs (30 d; dead jobs are kept for investigation), sent mail (90 d) and files of
 * documents deleted more than 90 days ago.
 */
export async function runMaintenance(db: DB, now = new Date()) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const counts: Record<string, number> = {};
  counts.sessions = (await db.delete(sessions).where(or(lt(sessions.expiresAt, ago(30)), lt(sessions.revokedAt, ago(30)))).returning({ id: sessions.id })).length;
  counts.rateLimits = (await db.delete(rateLimits).where(lt(rateLimits.windowStart, ago(1))).returning({ k: rateLimits.key })).length;
  counts.resetTokens = (
    await db.delete(passwordResetTokens).where(or(lt(passwordResetTokens.expiresAt, ago(7)), lt(passwordResetTokens.usedAt, ago(7)))).returning({ id: passwordResetTokens.id })
  ).length;
  counts.jobs = (await db.delete(jobs).where(and(eq(jobs.status, "done"), lt(jobs.completedAt, ago(30)))).returning({ id: jobs.id })).length;
  counts.mail = (await db.delete(mailOutbox).where(and(isNotNull(mailOutbox.sentAt), lt(mailOutbox.sentAt, ago(90)))).returning({ id: mailOutbox.id })).length;

  const purge = await db.select().from(documents).where(and(isNotNull(documents.deletedAt), lt(documents.deletedAt, ago(90))));
  for (const d of purge) {
    const file = path.join(/*turbopackIgnore: true*/ uploadRoot(), d.storageKey.slice(0, 2), d.storageKey);
    await unlink(file).catch(() => {});
    await db.delete(documents).where(eq(documents.id, d.id));
  }
  counts.documents = purge.length;
  if (Object.values(counts).some((n) => n > 0)) log.info("maintenance.done", counts);
  return counts;
}
