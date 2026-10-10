"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/server/web/actions";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function SubmitButton({ children, className = "btn btn-primary", pendingLabel }: { children: ReactNode; className?: string; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending}>
      {pending ? (pendingLabel ?? "Working…") : children}
    </button>
  );
}

/**
 * Form wired to a server action, with accessible success/error feedback.
 * Server-rendered children keep working without JavaScript (progressive enhancement).
 */
export function ActionForm({
  action,
  children,
  className,
  submitLabel,
  submitClassName,
  confirm,
  resetOnSuccess = false,
  inline = false,
}: {
  action: Action;
  children?: ReactNode;
  className?: string;
  submitLabel?: ReactNode;
  submitClassName?: string;
  confirm?: string;
  resetOnSuccess?: boolean;
  inline?: boolean;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className ?? (inline ? "inline-flex flex-wrap items-center gap-2" : "space-y-4")}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {submitLabel && <SubmitButton className={submitClassName}>{submitLabel}</SubmitButton>}
      {state.message && (
        <p
          key={state.at}
          role={state.ok ? "status" : "alert"}
          className={`whitespace-pre-line text-sm ${inline ? "" : "rounded-md px-3 py-2"} ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}
        >
          {state.message}
        </p>
      )}
      {state.secret && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm" role="status">
          <p className="font-semibold text-amber-900">Copy this now — it will not be shown again.</p>
          <code className="mt-1 block whitespace-pre-wrap break-all rounded bg-white px-2 py-1 font-mono text-xs">{state.secret}</code>
        </div>
      )}
    </form>
  );
}
