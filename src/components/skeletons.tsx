/** Placeholders shown by loading.tsx while a page loads. Announced once to screen readers. */
export function LoadingNote({ label }: { label: string }) {
  return <p className="sr-only" role="status">{label}</p>;
}

export function ProductGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="skeleton aspect-[4/3] rounded-none" />
          <div className="space-y-3 p-5">
            <div className="skeleton h-4 w-1/3" />
            <div className="skeleton h-5 w-4/5" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-5 w-1/4" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12" aria-hidden="true">
      <div className="skeleton h-9 w-2/5" />
      <div className="skeleton mt-4 h-5 w-3/5" />
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="skeleton aspect-[3/2] rounded-none" />
            <div className="space-y-3 p-5">
              <div className="skeleton h-5 w-3/4" />
              <div className="skeleton h-4 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
