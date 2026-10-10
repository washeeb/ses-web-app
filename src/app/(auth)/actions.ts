"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import {
  authenticate,
  confirmMfaEnrollment,
  createSession,
  loadActor,
  requestPasswordReset,
  resetPassword,
  revokeSession,
  verifyMfa,
} from "@/server/auth/service";
import { audit } from "@/server/modules/audit";
import { run, str, type ActionState } from "@/server/web/actions";
import { appUrl, clearSessionCookie, clientIp, getSessionState, homeFor, setSessionCookie } from "@/server/web/session";
import { headers } from "next/headers";

const loadActorById = (userId: string) => loadActor(getDb(), userId, null);

/** Only allow same-site relative redirects after login. */
function safeNext(next: string) {
  return /^\/(?!\/)[\w\-/?=&.%]*$/.test(next) ? next : null;
}

export async function login(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let destination: string | null = null;
  const result = await run(async () => {
    const db = getDb();
    const ip = await clientIp();
    const r = await authenticate(db, { email: str(fd, "email"), password: String(fd.get("password") ?? ""), ip });
    if (!r.ok) {
      return { ok: false, message: r.reason === "locked" ? "This account is temporarily locked after repeated failed attempts. Try again in 15 minutes or reset your password." : "Incorrect e-mail or password." };
    }
    const { token } = await createSession(db, r.userId, { ip, userAgent: (await headers()).get("user-agent") });
    await setSessionCookie(token);
    if (r.next === "mfa_verify") destination = "/login/mfa";
    else if (r.next === "mfa_enroll") destination = "/account/mfa";
    else destination = safeNext(str(fd, "next")) ?? homeFor((await loadActorById(r.userId))!);
  });
  if (!result.ok || !destination) return result;
  redirect(destination);
}

export async function verifyMfaAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const state = await getSessionState();
  if (!state) redirect("/login");
  const result = await run(() => verifyMfa(getDb(), state.actor.userId, state.sessionId, str(fd, "code")));
  if (!result.ok) return result;
  redirect(homeFor(state.actor));
}

export async function confirmEnrollmentAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const state = await getSessionState();
  if (!state) redirect("/login");
  const result = await run(() => confirmMfaEnrollment(getDb(), state.actor.userId, state.sessionId, str(fd, "code")));
  if (!result.ok) return result;
  redirect(homeFor(state.actor));
}

export async function forgotPassword(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await requestPasswordReset(getDb(), str(fd, "email"), appUrl(), await clientIp());
    return "If an account exists for that address, we have sent a reset link. It expires in 30 minutes.";
  });
}

export async function resetPasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const pw = String(fd.get("password") ?? "");
  if (pw !== String(fd.get("confirm") ?? "")) return { ok: false, message: "The passwords do not match.", at: Date.now() };
  return run(async () => {
    await resetPassword(getDb(), str(fd, "token"), pw);
    return "Your password has been changed. You can now sign in.";
  });
}

export async function logout() {
  const state = await getSessionState();
  if (state) {
    await revokeSession(getDb(), state.sessionId);
    await audit(getDb(), { actor: state.actor, action: "auth.logout" });
  }
  await clearSessionCookie();
  redirect("/login");
}
