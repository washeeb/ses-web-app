import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { getDb } from "@/server/db/client";
import { beginMfaEnrollment, pendingMfaSecret } from "@/server/auth/service";
import { getSessionState } from "@/server/web/session";
import { confirmEnrollmentAction, logout } from "../../actions";

export default async function MfaEnrollPage() {
  const state = await getSessionState();
  if (!state) redirect("/login");
  if (state.pending !== "mfa_enroll") redirect("/");
  const db = getDb();
  // The secret is created on first visit and only activated once a valid code is confirmed.
  const pending = (await pendingMfaSecret(db, state.actor.userId)) ?? (await beginMfaEnrollment(db, state.actor.userId));
  const grouped = pending.secret.match(/.{1,4}/g)!.join(" ");
  // Rendered on the server; the secret never leaves this page or reaches a third-party QR service.
  const qrSvg = await QRCode.toString(pending.uri, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#002253", light: "#ffffff" } });
  return (
    <>
      <h1 className="text-xl font-bold">Set up two-step verification</h1>
      <p className="mt-1 text-sm text-slate-600">
        Your account has administrative or sensitive permissions, so a second factor is required before you continue.
      </p>
      <ol className="mt-5 list-decimal space-y-3 pl-5 text-sm text-slate-700">
        <li>Open an authenticator app (for example Microsoft Authenticator, Google Authenticator or 1Password) and choose to add an account.</li>
        <li>
          Scan this QR code with the app:
          {/* eslint-disable-next-line @next/next/no-img-element -- inline data URI generated on the server */}
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg)}`}
            alt="QR code to add your Synclytics account to an authenticator app"
            width={200}
            height={200}
            className="mx-auto mt-3 block rounded-lg border border-slate-200"
          />
          <details className="mt-3">
            <summary className="cursor-pointer text-teal-700">Can&apos;t scan? Enter the setup key instead</summary>
            <code className="mt-2 block select-all rounded bg-slate-100 px-2 py-1.5 font-mono text-sm tracking-wider">{grouped}</code>
            <p className="mt-1 text-xs text-slate-500">Choose a time-based (TOTP) key. On a phone you can also <a href={pending.uri} className="text-teal-700 hover:underline">open it directly in the app</a>.</p>
          </details>
        </li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      <div className="mt-5">
        <ActionForm action={confirmEnrollmentAction} submitLabel="Turn on two-step verification" submitClassName="btn btn-primary w-full">
          <Field label="Authentication code" htmlFor="code">
            <input id="code" name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required className="field text-center text-lg tracking-[0.4em]" />
          </Field>
        </ActionForm>
      </div>
      <form action={logout} className="mt-4">
        <button className="text-sm text-slate-600 hover:underline">Cancel and sign out</button>
      </form>
    </>
  );
}
