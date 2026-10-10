import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { PASSWORD_MIN_LENGTH } from "@/server/auth/password";
import { resetPasswordAction } from "../actions";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="text-xl font-bold">Choose a new password</h1>
      {!token ? (
        <p className="mt-3 text-sm text-red-700" role="alert">This link is incomplete. Request a new reset link.</p>
      ) : (
        <div className="mt-6">
          <ActionForm action={resetPasswordAction} submitLabel="Change password" submitClassName="btn btn-primary w-full">
            <input type="hidden" name="token" value={token} />
            <Field label="New password" htmlFor="password" hint={`At least ${PASSWORD_MIN_LENGTH} characters. A passphrase works well.`}>
              <input id="password" name="password" type="password" minLength={PASSWORD_MIN_LENGTH} required autoComplete="new-password" className="field" />
            </Field>
            <Field label="Confirm new password" htmlFor="confirm">
              <input id="confirm" name="confirm" type="password" minLength={PASSWORD_MIN_LENGTH} required autoComplete="new-password" className="field" />
            </Field>
          </ActionForm>
        </div>
      )}
      <p className="mt-4 text-sm">
        <Link href="/login" className="text-teal-700 hover:underline">Back to sign in</Link>
      </p>
    </>
  );
}
