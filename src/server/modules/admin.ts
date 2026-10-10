import { and, asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db/client";
import { approvalRequests, departments, organizations, permissionSets, roleAssignments, users } from "../db/schema";
import { authorize, type Actor } from "../authz/policy";
import { PERMISSIONS, type Permission } from "../authz/permissions";
import { conflict, forbidden, invalid, notFound } from "../lib/errors";
import { randomToken } from "../lib/crypto";
import { hashPassword } from "../auth/password";
import { requestPasswordReset, revokeAllSessions } from "../auth/service";
import { audit } from "./audit";
import { publish } from "./events";
import { operatorOrgId } from "./settings";
import { notifyApprovers } from "./notifications";

export async function listOrganizations(db: DB, actor: Actor) {
  authorize(actor, "users.read");
  return db.select().from(organizations).orderBy(asc(organizations.type), asc(organizations.name));
}

export async function listUsers(db: DB, actor: Actor) {
  authorize(actor, "users.read");
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      mfaEnabled: users.mfaEnabled,
      lastLoginAt: users.lastLoginAt,
      lockedUntil: users.lockedUntil,
      organizationId: users.organizationId,
      organizationName: organizations.name,
      organizationType: organizations.type,
    })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .orderBy(asc(organizations.type), asc(users.name));
  const assignments = await db
    .select({ a: roleAssignments, setName: permissionSets.name, deptName: departments.name })
    .from(roleAssignments)
    .innerJoin(permissionSets, eq(permissionSets.id, roleAssignments.permissionSetId))
    .leftJoin(departments, eq(departments.id, roleAssignments.departmentId));
  return rows.map((u) => ({ ...u, assignments: assignments.filter((a) => a.a.userId === u.id) }));
}

export async function listPermissionSets(db: DB) {
  return db.select().from(permissionSets).orderBy(asc(permissionSets.domain), asc(permissionSets.name));
}

export async function listDepartments(db: DB, orgId?: string) {
  const id = orgId ?? (await operatorOrgId(db));
  return db.select().from(departments).where(eq(departments.organizationId, id)).orderBy(asc(departments.name));
}

const setIsPrivileged = (perms: string[]) => perms.some((p) => PERMISSIONS[p as Permission]?.privileged);

/** Inserts the assignment. Used directly for non-privileged sets and by the approvals module. */
export async function applyAssignment(tx: DB, input: { userId: string; permissionSetId: string; departmentId: string | null; grantedBy: string }) {
  const [user] = await tx.select().from(users).where(eq(users.id, input.userId));
  if (!user) throw notFound("User not found.");
  await tx
    .insert(roleAssignments)
    .values({ ...input, organizationId: user.organizationId })
    .onConflictDoNothing();
}

/**
 * Grants a permission set to a user in their own organisation.
 * Privileged sets need a second administrator's approval; nobody can change their own access.
 */
export async function assignRole(db: DB, actor: Actor, input: { userId: string; permissionSetId: string; departmentId?: string | null }) {
  authorize(actor, "permissions.manage");
  if (input.userId === actor.userId) throw forbidden("You cannot change your own permissions.");
  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .select({ u: users, orgType: organizations.type })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.organizationId))
      .where(eq(users.id, input.userId));
    if (!user) throw notFound("User not found.");
    const [set] = await tx
      .select()
      .from(permissionSets)
      .where(and(eq(permissionSets.id, input.permissionSetId), or(isNull(permissionSets.organizationId), eq(permissionSets.organizationId, user.u.organizationId))));
    if (!set) throw notFound("Permission set not found.");
    if (set.domain !== user.orgType) throw invalid(`"${set.name}" is for ${set.domain} organisations; this user belongs to a ${user.orgType} organisation.`);
    const departmentId = input.departmentId || null;
    if (departmentId) {
      const [dept] = await tx.select().from(departments).where(and(eq(departments.id, departmentId), eq(departments.organizationId, user.u.organizationId)));
      if (!dept) throw invalid("Department does not belong to the user's organisation.");
    }
    const payload = { userId: user.u.id, email: user.u.email, permissionSetId: set.id, setName: set.name, departmentId };
    if (setIsPrivileged(set.permissions)) {
      const [pending] = await tx
        .select({ id: approvalRequests.id })
        .from(approvalRequests)
        .where(and(eq(approvalRequests.type, "permission.change"), eq(approvalRequests.subjectId, user.u.id), eq(approvalRequests.status, "pending")));
      if (pending) throw conflict("A permission change for this user is already awaiting approval.");
      const [req] = await tx
        .insert(approvalRequests)
        .values({
          organizationId: await operatorOrgId(tx),
          type: "permission.change",
          subjectType: "user",
          subjectId: user.u.id,
          summary: `Grant "${set.name}" to ${user.u.email}`,
          payload,
          requestedBy: actor.userId,
        })
        .returning();
      await audit(tx, { actor, action: "permission.change_requested", targetType: "user", targetId: user.u.id, data: { ...payload, approvalId: req!.id } });
      await notifyApprovers(tx, "permission.change", user.u.id, req!.summary, actor.userId);
      return { applied: false };
    }
    await applyAssignment(tx, { userId: user.u.id, permissionSetId: set.id, departmentId, grantedBy: actor.userId });
    await audit(tx, { actor, action: "permission.granted", targetType: "user", targetId: user.u.id, data: payload });
    return { applied: true };
  });
  publish({ topic: "approvals" });
  return result;
}

export async function revokeAssignment(db: DB, actor: Actor, assignmentId: string) {
  authorize(actor, "permissions.manage");
  const [a] = await db.select().from(roleAssignments).where(eq(roleAssignments.id, assignmentId));
  if (!a) throw notFound("Assignment not found.");
  if (a.userId === actor.userId) throw forbidden("You cannot change your own permissions.");
  await db.delete(roleAssignments).where(eq(roleAssignments.id, assignmentId));
  await revokeAllSessions(db, a.userId); // force re-login so the reduced access applies everywhere
  await audit(db, { actor, action: "permission.revoked", targetType: "user", targetId: a.userId, data: { permissionSetId: a.permissionSetId, departmentId: a.departmentId } });
}

export const newUserInput = z.object({
  organizationId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(120),
});

/** Creates the account with an unusable random password and e-mails a set-password link. */
export async function createUser(db: DB, actor: Actor, input: z.input<typeof newUserInput>, appUrl: string) {
  authorize(actor, "users.manage");
  const data = newUserInput.parse(input);
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email));
  if (exists) throw conflict("An account with that e-mail already exists.");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, data.organizationId));
  if (!org) throw invalid("Unknown organisation.");
  const [user] = await db
    .insert(users)
    .values({ ...data, passwordHash: await hashPassword(randomToken(24)) })
    .returning();
  await audit(db, { actor, action: "user.created", targetType: "user", targetId: user!.id, data: { email: data.email, organizationId: org.id } });
  await requestPasswordReset(db, data.email, appUrl);
  return user!;
}

export async function setUserStatus(db: DB, actor: Actor, userId: string, status: "active" | "disabled") {
  authorize(actor, "users.manage");
  if (userId === actor.userId) throw forbidden("You cannot change your own account status.");
  const [u] = await db.update(users).set({ status, ...(status === "active" ? { lockedUntil: null, failedLogins: 0 } : {}) }).where(eq(users.id, userId)).returning();
  if (!u) throw notFound("User not found.");
  if (status === "disabled") await revokeAllSessions(db, userId);
  await audit(db, { actor, action: `user.${status === "active" ? "enabled" : "disabled"}`, targetType: "user", targetId: userId });
}

export const departmentInput = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,40}$/, "Key: lowercase letters, digits, underscores."),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().default(""),
});

export async function createDepartment(db: DB, actor: Actor, input: z.input<typeof departmentInput>) {
  authorize(actor, "departments.manage");
  const data = departmentInput.parse(input);
  const orgId = await operatorOrgId(db);
  const [row] = await db.insert(departments).values({ ...data, organizationId: orgId }).onConflictDoNothing().returning();
  if (!row) throw conflict("A department with that key already exists.");
  await audit(db, { actor, action: "department.created", targetType: "department", targetId: row.id, data });
  return row;
}

export async function setDepartmentActive(db: DB, actor: Actor, id: string, active: boolean) {
  authorize(actor, "departments.manage");
  await db.update(departments).set({ active }).where(eq(departments.id, id));
  await audit(db, { actor, action: active ? "department.activated" : "department.deactivated", targetType: "department", targetId: id });
}
