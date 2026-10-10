import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { getSessionState, homeFor } from "@/server/web/session";
import { login } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const state = await getSessionState();
  if (state && !state.pending) redirect(homeFor(state.actor));
  const { next } = await searchParams;
  return (
    <>
      <h1 className="text-xl font-bold">Sign in</h1>
      <p className="mt-1 text-sm text-slate-600">Staff, customers and partners use the same sign-in.</p>
      <div className="mt-6">
        <ActionForm action={login} submitLabel="Sign in" submitClassName="btn btn-primary w-full">
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label="E-mail" htmlFor="email">
            <input id="email" name="email" type="email" required autoComplete="username" className="field" />
          </Field>
          <Field label="Password" htmlFor="password">
            <input id="password" name="password" type="password" required autoComplete="current-password" className="field" />
          </Field>
        </ActionForm>
      </div>
      <p className="mt-4 text-sm">
        <Link href="/forgot-password" className="text-teal-700 hover:underline">Forgot your password?</Link>
      </p>
    </>
  );
}
