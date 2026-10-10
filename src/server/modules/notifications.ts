import { and, arrayContains, count, desc, eq, isNull } from "drizzle-orm";
import type { DB } from "../db/client";
import { notifications, organizations, permissionSets, roleAssignments, users } from "../db/schema";
import { PERMISSIONS, type Permission } from "../authz/permissions";
import type { Actor } from "../authz/policy";
import { publish } from "./events";
import { APPROVAL_TYPES } from "./approval-types";

/**
 * In-app notifications. Written inside the caller's transaction, so a notification exists exactly when
 * the event that caused it was committed. Recipients are resolved from permissions at the time of the event.
 */
export interface NotificationInput {
  title: string;
  body?: string;
  link?: string;
}

export async function notifyUsers(db: DB, userIds: string[], n: NotificationInput) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return 0;
  await db.insert(notifications).values(unique.map((userId) => ({ userId, title: n.title.slice(0, 200), body: n.body?.slice(0, 1000) ?? null, link: n.link ?? null })));
  return unique.length;
}

/** Active users holding a permission in an organisation of the permission's domain (optionally one organisation). */
export async function usersWithPermission(db: DB, perm: Permission, organizationId?: string) {
  const domain = PERMISSIONS[perm].domain;
  const conds = [arrayContains(permissionSets.permissions, [perm]), eq(organizations.type, domain), eq(organizations.status, "active"), eq(users.status, "active")];
  if (organizationId) conds.push(eq(roleAssignments.organizationId, organizationId));
  const rows = await db
    .selectDistinct({ id: users.id })
    .from(roleAssignments)
    .innerJoin(permissionSets, eq(permissionSets.id, roleAssignments.permissionSetId))
    .innerJoin(organizations, eq(organizations.id, roleAssignments.organizationId))
    .innerJoin(users, eq(users.id, roleAssignments.userId))
    .where(and(...conds));
  return rows.map((r) => r.id);
}

export async function notifyPermission(db: DB, perm: Permission, n: NotificationInput, opts: { organizationId?: string; exclude?: string | null } = {}) {
  const ids = (await usersWithPermission(db, perm, opts.organizationId)).filter((id) => id !== opts.exclude);
  return notifyUsers(db, ids, n);
}

/** Tells everyone who may decide an approval request (except the requester) that it is waiting. */
export async function notifyApprovers(db: DB, type: string, subjectId: string, summary: string, requestedBy: string | null) {
  const t = APPROVAL_TYPES[type];
  if (!t) return 0;
  return notifyPermission(db, t.permission, { title: `${t.label} awaiting your approval`, body: summary, link: "/ops/approvals" }, { exclude: requestedBy });
}

/** Call after the transaction commits so open pages refresh their bell. */
export function announce() {
  publish({ topic: "notifications" });
}

// ───────────────────────────── Reading ─────────────────────────────

export async function listNotifications(db: DB, actor: Actor, limit = 50) {
  return db.select().from(notifications).where(eq(notifications.userId, actor.userId)).orderBy(desc(notifications.createdAt)).limit(limit);
}

export async function unreadCount(db: DB, actor: Actor) {
  const [r] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

/** Marks one notification (or all, when id is null) as read — only the actor's own. */
export async function markRead(db: DB, actor: Actor, id: string | null) {
  const conds = [eq(notifications.userId, actor.userId), isNull(notifications.readAt)];
  if (id) conds.push(eq(notifications.id, id));
  await db.update(notifications).set({ readAt: new Date() }).where(and(...conds));
}

/** Customer-organisation users who may see orders/quotes (for status updates). */
export async function customerRecipients(db: DB, perm: "customer.orders.read" | "customer.quotes.read", organizationId: string, exclude?: string) {
  const ids = await usersWithPermission(db, perm, organizationId);
  return exclude ? ids.filter((i) => i !== exclude) : ids;
}


