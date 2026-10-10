import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { forgotPassword } from "../actions";

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-xl font-bold">Reset your password</h1>
      <p className="mt-1 text-sm text-slate-600">We will e-mail you a link to choose a new password.</p>
      <div className="mt-6">
        <ActionForm action={forgotPassword} submitLabel="Send reset link" submitClassName="btn btn-primary w-full">
          <Field label="E-mail" htmlFor="email">
            <input id="email" name="email" type="email" required autoComplete="username" className="field" />
          </Field>
        </ActionForm>
      </div>
      <p className="mt-4 text-sm">
        <Link href="/login" className="text-teal-700 hover:underline">Back to sign in</Link>
      </p>
    </>
  );
}
