import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { setupDb, TEST_PASSWORD } from "./helpers";
import type { DB } from "@/server/db/client";
import { mailOutbox, users } from "@/server/db/schema";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { base32Encode, totpAt, verifyTotp, currentStep } from "@/server/auth/totp";
import {
  authenticate,
  beginMfaEnrollment,
  confirmMfaEnrollment,
  createSession,
  requestPasswordReset,
  resetPassword,
  SESSION_IDLE_MS,
  validateSession,
  verifyMfa,
} from "@/server/auth/service";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await setupDb()));
afterAll(() => close());

describe("passwords", () => {
  it("hashes with a salt and verifies", async () => {
    const a = await hashPassword("a-long-password-123");
    const b = await hashPassword("a-long-password-123");
    expect(a).not.toEqual(b);
    expect(await verifyPassword("a-long-password-123", a)).toBe(true);
    expect(await verifyPassword("wrong-password-123", a)).toBe(false);
  });
});

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC test vector", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpAt(secret, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30), 8)).toBe("07081804");
  });
  it("accepts ±1 step of drift only", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    const now = 1_700_000_000_000;
    const step = currentStep(now);
    expect(verifyTotp(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 3), now)).toBeNull();
  });
});

describe("login", () => {
  it("rejects unknown users and wrong passwords with the same result", async () => {
    expect(await authenticate(db, { email: "nobody@example.com", password: "x".repeat(12), ip: "1.1.1.1" })).toEqual({ ok: false, reason: "invalid" });
    expect(await authenticate(db, { email: "sales@ses.demo", password: "wrong-password!!", ip: "1.1.1.1" })).toEqual({ ok: false, reason: "invalid" });
  });

  it("requires MFA enrolment for privileged users and not for ordinary ones", async () => {
    expect(await authenticate(db, { email: "sales@ses.demo", password: TEST_PASSWORD, ip: "1.1.1.2" })).toMatchObject({ ok: true, next: "done" });
    expect(await authenticate(db, { email: "admin@ses.demo", password: TEST_PASSWORD, ip: "1.1.1.2" })).toMatchObject({ ok: true, next: "mfa_enroll" });
  });

  it("locks the account after 5 failures, even with the right password", async () => {
    for (let i = 0; i < 4; i++) await authenticate(db, { email: "support@ses.demo", password: "bad-password-xx", ip: `2.0.0.${i}` });
    expect(await authenticate(db, { email: "support@ses.demo", password: "bad-password-xx", ip: "2.0.0.9" })).toEqual({ ok: false, reason: "locked" });
    expect(await authenticate(db, { email: "support@ses.demo", password: TEST_PASSWORD, ip: "2.0.0.10" })).toEqual({ ok: false, reason: "locked" });
  });

  it("rate-limits repeated attempts from one IP", async () => {
    let limited = false;
    for (let i = 0; i < 35 && !limited; i++) {
      try {
        await authenticate(db, { email: `x${i}@example.com`, password: "whatever-pass", ip: "9.9.9.9" });
      } catch (e) {
        limited = (e as { code?: string }).code === "rate_limited";
      }
    }
    expect(limited).toBe(true);
  });
});

describe("sessions", () => {
  it("validates, expires on idle and stores only a hash", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "exec@ses.demo"));
    const t0 = new Date();
    const { token, session } = await createSession(db, u!.id, { ip: "1.2.3.4" }, t0);
    expect(session.tokenHash).not.toContain(token);
    expect(await validateSession(db, token, t0)).not.toBeNull();
    expect(await validateSession(db, "not-a-token", t0)).toBeNull();
    expect(await validateSession(db, token, new Date(t0.getTime() + SESSION_IDLE_MS + 1000))).toBeNull();
    // Once revoked for idleness it stays invalid.
    expect(await validateSession(db, token, t0)).toBeNull();
  });
});

describe("MFA enrolment and verification", () => {
  it("enrols, verifies and rejects code reuse", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "finance@ses.demo"));
    const { session } = await createSession(db, u!.id, {});
    const { secret } = await beginMfaEnrollment(db, u!.id);
    const now = Date.now();
    await confirmMfaEnrollment(db, u!.id, session.id, totpAt(secret, currentStep(now)), new Date(now));
    const s2 = await createSession(db, u!.id, {});
    // Same code (same step) cannot be used again.
    await expect(verifyMfa(db, u!.id, s2.session.id, totpAt(secret, currentStep(now)), new Date(now))).rejects.toThrow(/not valid/);
    await verifyMfa(db, u!.id, s2.session.id, totpAt(secret, currentStep(now) + 1), new Date(now + 30_000));
    expect((await validateSession(db, s2.token))?.mfaVerified).toBe(true);
  });
});

describe("password reset", () => {
  it("is single-use, revokes sessions and does not reveal unknown e-mails", async () => {
    await expect(requestPasswordReset(db, "unknown@example.com", "http://x", "5.5.5.5")).resolves.toBeUndefined();
    const [u] = await db.select().from(users).where(eq(users.email, "engineer@ses.demo"));
    const { token: sessionToken } = await createSession(db, u!.id, {});
    await requestPasswordReset(db, "engineer@ses.demo", "http://x", "5.5.5.5");
    const [mail] = await db.select().from(mailOutbox).where(eq(mailOutbox.to, "engineer@ses.demo")).orderBy(desc(mailOutbox.createdAt));
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail!.body)![1]!;
    await expect(resetPassword(db, token, "short")).rejects.toThrow(/at least 12/);
    await resetPassword(db, token, "A-brand-new-password-1");
    await expect(resetPassword(db, token, "Another-new-password-2")).rejects.toThrow(/invalid or has expired/);
    expect(await validateSession(db, sessionToken)).toBeNull();
    expect(await authenticate(db, { email: "engineer@ses.demo", password: "A-brand-new-password-1", ip: "6.6.6.6" })).toMatchObject({ ok: true });
  });
});
