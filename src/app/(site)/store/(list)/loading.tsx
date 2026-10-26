import { LoadingNote, ProductGridSkeleton } from "@/components/skeletons";

// In its own route group so it covers only the list: on a page that can be "not found" (a product) a loading
// view would turn the 404 into a 200.

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <LoadingNote label="Loading products" />
      <div className="skeleton h-9 w-1/3" aria-hidden="true" />
      <div className="mt-6 flex gap-2 overflow-hidden" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-10 w-36 shrink-0 rounded-full" />)}
      </div>
      <div className="mt-6 grid gap-8 lg:grid-cols-[240px_1fr]">
        <div className="hidden space-y-2 lg:block" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-8" />)}
        </div>
        <div>
          <div className="skeleton h-14 rounded-2xl" aria-hidden="true" />
          <div className="mt-6">
            <ProductGridSkeleton />
          </div>
        </div>
      </div>
    </div>
  );
}
