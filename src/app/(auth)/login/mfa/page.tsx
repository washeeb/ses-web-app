import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { getSessionState } from "@/server/web/session";
import { logout, verifyMfaAction } from "../../actions";

export default async function MfaVerifyPage() {
  const state = await getSessionState();
  if (!state) redirect("/login");
  if (state.pending !== "mfa_verify") redirect("/");
  return (
    <>
      <h1 className="text-xl font-bold">Two-step verification</h1>
      <p className="mt-1 text-sm text-slate-600">Enter the 6-digit code from your authenticator app.</p>
      <div className="mt-6">
        <ActionForm action={verifyMfaAction} submitLabel="Verify" submitClassName="btn btn-primary w-full">
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
