import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { organizations, passwordResetTokens, permissionSets, roleAssignments, sessions, users } from "../db/schema";
import { isPrivileged, type Actor, type Grant } from "../authz/policy";
import type { Domain } from "../authz/permissions";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../lib/crypto";
import { AppError, invalid } from "../lib/errors";
import { audit } from "../modules/audit";
import { sendMail } from "../modules/mail";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { generateTotpSecret, otpauthUri, verifyTotp } from "./totp";
import { enforce } from "./rate-limit";

export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
const RESET_TOKEN_MS = 30 * 60 * 1000;

// A real hash so that unknown e-mails take as long as wrong passwords.
let dummyHash: Promise<string> | null = null;

export async function loadGrants(db: DB, userId: string): Promise<Grant[]> {
  const rows = await db
    .select({
      permissions: permissionSets.permissions,
      setDomain: permissionSets.domain,
      organizationId: roleAssignments.organizationId,
      organizationType: organizations.type,
      departmentId: roleAssignments.departmentId,
    })
    .from(roleAssignments)
    .innerJoin(permissionSets, eq(permissionSets.id, roleAssignments.permissionSetId))
    .innerJoin(organizations, eq(organizations.id, roleAssignments.organizationId))
    .where(and(eq(roleAssignments.userId, userId), eq(organizations.status, "active")));
  return rows
    .filter((r) => r.setDomain === r.organizationType)
    .map((r) => ({
      permissions: new Set(r.permissions),
      organizationId: r.organizationId,
      organizationType: r.organizationType as Domain,
      departmentId: r.departmentId,
    }));
}

export async function loadActor(db: DB, userId: string, session: { id: string; mfaVerified: boolean } | null): Promise<Actor | null> {
  const [row] = await db
    .select({ user: users, orgType: organizations.type })
    .from(users)
    .innerJoin(organizations, eq(organizations.id, users.organizationId))
    .where(eq(users.id, userId));
  if (!row || row.user.status !== "active") return null;
  return {
    userId: row.user.id,
    name: row.user.name,
    email: row.user.email,
    organizationId: row.user.organizationId,
    organizationType: row.orgType as Domain,
    sessionId: session?.id ?? null,
    mfaVerified: session?.mfaVerified ?? false,
    grants: await loadGrants(db, userId),
  };
}

export type LoginResult =
  | { ok: true; userId: string; next: "mfa_verify" | "mfa_enroll" | "done" }
  | { ok: false; reason: "invalid" | "locked" };

export async function authenticate(db: DB, input: { email: string; password: string; ip?: string | null }, now = new Date()): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  await enforce(db, `login:ip:${input.ip ?? "unknown"}`, 30, 15 * 60);
  await enforce(db, `login:email:${email}`, 10, 15 * 60);

  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) {
    dummyHash ??= hashPassword("not-a-real-password-placeholder");
    await verifyPassword(input.password, await dummyHash);
    return { ok: false, reason: "invalid" };
  }
  if (user.lockedUntil && user.lockedUntil > now) {
    await audit(db, { actor: { userId: user.id, organizationId: user.organizationId }, action: "auth.login_blocked_locked", ip: input.ip });
    return { ok: false, reason: "locked" };
  }
  const valid = user.status === "active" && (await verifyPassword(input.password, user.passwordHash));
  if (!valid) {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await db
      .update(users)
      .set({ failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(now.getTime() + LOCKOUT_MS) : user.lockedUntil })
      .where(eq(users.id, user.id));
    await audit(db, {
      actor: { userId: user.id, organizationId: user.organizationId },
      action: lock ? "auth.account_locked" : "auth.login_failed",
      ip: input.ip,
    });
    return { ok: false, reason: lock ? "locked" : "invalid" };
  }
  await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, user.id));
  await audit(db, { actor: { userId: user.id, organizationId: user.organizationId }, action: "auth.login", ip: input.ip });

  if (user.mfaEnabled) return { ok: true, userId: user.id, next: "mfa_verify" };
  const privileged = isPrivileged(await loadGrants(db, user.id));
  return { ok: true, userId: user.id, next: privileged ? "mfa_enroll" : "done" };
}

export async function createSession(db: DB, userId: string, meta: { ip?: string | null; userAgent?: string | null }, now = new Date()) {
  const token = randomToken(32);
  const [s] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: sha256(token),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
      lastSeenAt: now,
    })
    .returning();
  return { token, session: s! };
}

export async function validateSession(db: DB, token: string, now = new Date()) {
  if (!token || token.length > 100) return null;
  const [s] = await db.select().from(sessions).where(eq(sessions.tokenHash, sha256(token)));
  if (!s || s.revokedAt || s.expiresAt <= now) return null;
  if (now.getTime() - s.lastSeenAt.getTime() > SESSION_IDLE_MS) {
    await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, s.id));
    return null;
  }
  // Throttle writes: only bump last-seen once a minute.
  if (now.getTime() - s.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, s.id));
  }
  return s;
}

export async function revokeSession(db: DB, sessionId: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
}

export async function revokeAllSessions(db: DB, userId: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

async function acceptTotp(db: DB, userId: string, code: string, now: Date, secretOverride?: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw invalid("Unknown user.");
  await enforce(db, `mfa:${userId}`, 8, 15 * 60);
  const secretEnc = secretOverride ?? user.mfaSecretEnc;
  if (!secretEnc) throw invalid("Multi-factor authentication is not set up.");
  const step = verifyTotp(decryptSecret(secretEnc), code.trim(), now.getTime());
  if (step === null || (user.mfaLastStep !== null && step <= user.mfaLastStep)) {
    await audit(db, { actor: { userId, organizationId: user.organizationId }, action: "auth.mfa_failed" });
    throw invalid("That code is not valid. Check your authenticator app and try again.");
  }
  await db.update(users).set({ mfaLastStep: step }).where(eq(users.id, userId));
  return user;
}

export async function verifyMfa(db: DB, userId: string, sessionId: string, code: string, now = new Date()) {
  const user = await acceptTotp(db, userId, code, now);
  await db.update(sessions).set({ mfaVerified: true }).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  await audit(db, { actor: { userId, organizationId: user.organizationId }, action: "auth.mfa_verified" });
}

/** Starts (or restarts) enrolment. The secret is only active after confirmMfaEnrollment. */
export async function beginMfaEnrollment(db: DB, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw invalid("Unknown user.");
  if (user.mfaEnabled) throw invalid("Multi-factor authentication is already enabled.");
  const secret = generateTotpSecret();
  await db.update(users).set({ mfaSecretEnc: encryptSecret(secret), mfaLastStep: null }).where(eq(users.id, userId));
  return { secret, uri: otpauthUri(secret, user.email) };
}

export async function pendingMfaSecret(db: DB, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.mfaSecretEnc || user.mfaEnabled) return null;
  const secret = decryptSecret(user.mfaSecretEnc);
  return { secret, uri: otpauthUri(secret, user.email) };
}

export async function confirmMfaEnrollment(db: DB, userId: string, sessionId: string, code: string, now = new Date()) {
  const user = await acceptTotp(db, userId, code, now);
  await db.update(users).set({ mfaEnabled: true }).where(eq(users.id, userId));
  await db.update(sessions).set({ mfaVerified: true }).where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)));
  await audit(db, { actor: { userId, organizationId: user.organizationId }, action: "auth.mfa_enrolled" });
}

/** Always behaves the same whether or not the e-mail exists (no account enumeration). */
export async function requestPasswordReset(db: DB, email: string, appUrl: string, ip?: string | null) {
  await enforce(db, `reset:ip:${ip ?? "unknown"}`, 10, 60 * 60);
  const normalized = email.trim().toLowerCase();
  await enforce(db, `reset:email:${normalized}`, 3, 60 * 60);
  const [user] = await db.select().from(users).where(eq(users.email, normalized));
  if (!user || user.status !== "active") return;
  const token = randomToken(32);
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_MS),
  });
  await sendMail(db, {
    to: user.email,
    subject: "Reset your Synclytics password",
    body: `A password reset was requested for your account.\n\nReset link (valid 30 minutes, single use):\n${appUrl}/reset-password?token=${token}\n\nIf you did not request this, ignore this message.`,
  });
  await audit(db, { actor: { userId: user.id, organizationId: user.organizationId }, action: "auth.reset_requested", ip });
}

export async function resetPassword(db: DB, token: string, newPassword: string, now = new Date()) {
  const problem = passwordProblem(newPassword);
  if (problem) throw invalid(problem);
  const passwordHash = await hashPassword(newPassword);
  return db.transaction(async (tx) => {
    // Mark used atomically so the same token cannot be redeemed twice.
    const [t] = await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.tokenHash, sha256(token)), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, now)))
      .returning();
    if (!t) throw new AppError("validation", "This reset link is invalid or has expired.");
    const [user] = await tx
      .update(users)
      .set({ passwordHash, passwordChangedAt: now, failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, t.userId))
      .returning();
    await revokeAllSessions(tx, t.userId);
    await audit(tx, { actor: { userId: t.userId, organizationId: user!.organizationId }, action: "auth.password_reset" });
  });
}

/** Admin-only helper used by seeding and user management. */
export async function setPassword(db: DB, userId: string, password: string) {
  const problem = passwordProblem(password);
  if (problem) throw invalid(problem);
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), passwordChangedAt: sql`now()` })
    .where(eq(users.id, userId));
}
