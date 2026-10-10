import { desc } from "drizzle-orm";
import type { DB } from "../db/client";
import { auditLog } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";

export interface AuditEntry {
  actor?: Pick<Actor, "userId" | "organizationId"> | null;
  action: string;
  targetType?: string;
  targetId?: string;
  data?: Record<string, unknown>;
  ip?: string | null;
}

/** Append-only. Never store secrets, passwords or tokens in `data`. */
export async function audit(db: DB, e: AuditEntry) {
  await db.insert(auditLog).values({
    actorUserId: e.actor?.userId ?? null,
    actorOrgId: e.actor?.organizationId ?? null,
    action: e.action,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    data: e.data ?? {},
    ip: e.ip ?? null,
  });
}

export async function listAudit(db: DB, actor: Actor, limit = 200) {
  authorize(actor, "audit.read");
  return db.select().from(auditLog).orderBy(desc(auditLog.at)).limit(limit);
}
