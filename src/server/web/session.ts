import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db/client";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { isPrivileged, type Actor } from "../authz/policy";
import { loadActor, SESSION_ABSOLUTE_MS, validateSession } from "../auth/service";

export const SESSION_COOKIE = "ses_session";

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_ABSOLUTE_MS / 1000,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Client IP. Only trusts X-Forwarded-For when TRUST_PROXY=true (behind a known reverse proxy). */
export async function clientIp(): Promise<string | null> {
  const h = await headers();
  if (process.env.TRUST_PROXY === "true") {
    const xff = h.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]!.trim().slice(0, 64);
  }
  return h.get("x-real-ip") ?? "local";
}

export interface SessionState {
  actor: Actor;
  sessionId: string;
  /** What must happen before the user may continue. */
  pending: "mfa_verify" | "mfa_enroll" | null;
}

/** Per-request cached session lookup. */
export const getSessionState = cache(async (): Promise<SessionState | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const session = await validateSession(db, token);
  if (!session) return null;
  const actor = await loadActor(db, session.userId, session);
  if (!actor) return null;
  const [user] = await db.select({ mfaEnabled: users.mfaEnabled }).from(users).where(eq(users.id, actor.userId));
  let pending: SessionState["pending"] = null;
  if (user?.mfaEnabled && !session.mfaVerified) pending = "mfa_verify";
  else if (!user?.mfaEnabled && isPrivileged(actor.grants)) pending = "mfa_enroll";
  return { actor, sessionId: session.id, pending };
});

export function homeFor(actor: Actor) {
  return actor.organizationType === "operator" ? "/ops" : actor.organizationType === "partner" ? "/partner" : "/portal";
}

/** Guards a server component or action. Redirects instead of throwing. */
export async function requireActor(surface?: Actor["organizationType"], nextPath?: string): Promise<Actor> {
  const state = await getSessionState();
  if (!state) redirect(`/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`);
  if (state.pending === "mfa_verify") redirect("/login/mfa");
  if (state.pending === "mfa_enroll") redirect("/account/mfa");
  if (surface && state.actor.organizationType !== surface) redirect(homeFor(state.actor));
  return state.actor;
}

export function appUrl() {
  return process.env.APP_URL ?? "http://localhost:3000";
}
