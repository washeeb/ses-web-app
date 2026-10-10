"use client";

/** Keeps the surrounding navigation when a page fails or the user lacks permission. */
export default function SectionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-8 text-center" role="alert">
      <h1 className="text-xl font-bold">You can&apos;t open this page</h1>
      <p className="mt-2 text-sm text-slate-600">Your role may not include access to it, or something went wrong. If you need access, ask an administrator.</p>
      {error.digest && <p className="mt-1 text-xs text-slate-400">Reference: {error.digest}</p>}
      <button onClick={reset} className="btn btn-ghost mt-4">Try again</button>
    </div>
  );
}
