import Link from "next/link";
import { AvailabilityBadge } from "@/components/availability";
import { NoPicture, Picture } from "@/components/picture";
import { Money } from "@/components/ui";
import type { Availability } from "@/server/modules/inventory";
import { PRODUCT_TYPE_LABEL, type ProductType } from "@/server/modules/catalogue";

type Img = { id: string; ext: string; widths: number[]; width: number; height: number; alt: string };
export type CardProduct = {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  isDemo: boolean;
  type?: string;
  brandName: string | null;
  categoryName: string | null;
  image: Img | null;
  variants: { priceMinor: number | null; currency: string; billingPeriod?: string | null; availability: Availability }[];
};

/** Product tile: the whole card is one link (stretched over the card), with a lift and zoom on hover. */
export function ProductCard({ p, priority = false, basePath = "/store", heading: Heading = "h2" }: { p: CardProduct; priority?: boolean; basePath?: string; heading?: "h2" | "h3" | "h4" }) {
  const from = p.variants[0]!;
  const onRequest = from.priceMinor === null;
  return (
    <li className="lift reveal group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="relative overflow-hidden bg-white">
        {p.image ? (
          <Picture m={p.image} sizes="(min-width: 1280px) 300px, (min-width: 640px) 45vw, 100vw" fallbackWidth={800} priority={priority} className="zoom aspect-[4/3] w-full object-contain p-3" alt="" />
        ) : (
          <NoPicture label={p.name} className="aspect-[4/3] w-full" />
        )}
        {p.brandName && <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-0.5 text-xs font-semibold text-slate-800 shadow-sm ring-1 ring-slate-200">{p.brandName}</span>}
        {p.isDemo && <span className="absolute right-3 top-3 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">Demonstration</span>}
      </div>
      <div className="flex flex-1 flex-col border-t border-slate-100 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{[p.type && p.type !== "hardware" ? PRODUCT_TYPE_LABEL[p.type as ProductType] : null, p.categoryName].filter(Boolean).join(" · ")}</p>
        <Heading className="mt-1 line-clamp-2 text-base font-semibold leading-snug text-slate-900">
          <Link href={`${basePath}/${p.slug}`} className="plain after:absolute after:inset-0 group-hover:text-teal-700">
            {p.name}
          </Link>
        </Heading>
        {p.summary && <p className="mt-1 line-clamp-2 flex-1 text-sm text-slate-600">{p.summary}</p>}
        <div className="mt-4 flex items-center justify-between gap-2">
          {onRequest ? (
            <span className="whitespace-nowrap rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800">Price on request</span>
          ) : (
            <p className="text-lg font-bold text-slate-900">
              {p.variants.length > 1 && <span className="text-xs font-normal text-slate-600">From </span>}
              <Money minor={from.priceMinor!} currency={from.currency} />
              {from.billingPeriod && <span className="text-sm font-normal text-slate-500"> / {from.billingPeriod}</span>}
            </p>
          )}
          <AvailabilityBadge a={from.availability} />
        </div>
      </div>
    </li>
  );
}

/** Page links: previous / numbered (with gaps) / next, keeping the current filters. */
export function Pagination({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null;
  const nums = [...new Set([1, page - 1, page, page + 1, pages].filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b);
  const cell = "inline-grid h-10 min-w-10 place-items-center rounded-full px-3 text-sm font-medium";
  return (
    <nav aria-label="Pages" className="mt-10 flex flex-wrap items-center justify-center gap-1.5">
      {page > 1 ? <Link href={href(page - 1)} className={`${cell} border border-slate-200 bg-white hover:border-teal-700`} rel="prev">← Previous</Link> : <span className={`${cell} text-slate-500`}>← Previous</span>}
      {nums.map((n, i) => (
        <span key={n} className="contents">
          {i > 0 && n - nums[i - 1]! > 1 && <span className="px-1 text-slate-500" aria-hidden="true">…</span>}
          {n === page ? (
            <span aria-current="page" className={`${cell} bg-slate-900 text-white`}>{n}</span>
          ) : (
            <Link href={href(n)} className={`${cell} border border-slate-200 bg-white hover:border-teal-700`}>
              <span className="sr-only">Page </span>{n}
            </Link>
          )}
        </span>
      ))}
      {page < pages ? <Link href={href(page + 1)} className={`${cell} border border-slate-200 bg-white hover:border-teal-700`} rel="next">Next →</Link> : <span className={`${cell} text-slate-500`}>Next →</span>}
    </nav>
  );
}

type Cat = { id: string; slug: string; name: string; parentId: string | null; depth: number; count: number };

/** Category chips: scrolls sideways on phones. Pictures make the top level easy to scan. */
export function CategoryChips({ items, active, href, images, label }: { items: Cat[]; active?: string; href: (slug?: string) => string; images?: Map<string, Img>; label: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label={label} className="chip-row -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {items.map((c) => {
        const on = c.slug === active;
        const img = images?.get(c.id);
        return (
          <Link
            key={c.id}
            href={href(c.slug)}
            aria-current={on ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 rounded-full border py-1.5 pr-4 text-sm font-medium transition-colors ${img ? "pl-1.5" : "pl-4"} ${on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800 hover:border-teal-700 hover:text-teal-800"}`}
          >
            {img && <Picture m={img} sizes="32px" fallbackWidth={320} className="h-8 w-8 rounded-full object-cover" alt="" />}
            {c.name}
            <span className={`text-xs ${on ? "text-slate-300" : "text-slate-500"}`}>{c.count}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Desktop category tree: each top level opens to show its sub-categories, the current one already open. */
export function CategorySidebar({ items, active, href }: { items: Cat[]; active?: string; href: (slug?: string) => string }) {
  const tops = items.filter((c) => c.depth === 0);
  const activeCat = items.find((c) => c.slug === active);
  const openId = activeCat?.parentId ?? activeCat?.id;
  const total = tops.reduce((n, c) => n + c.count, 0);
  const row = (on: boolean) => `plain flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${on ? "bg-teal-50 font-semibold text-teal-900" : "text-slate-700 hover:bg-slate-100"}`;
  return (
    <nav aria-label="Store categories" className="hidden lg:block">
      <h2 className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Categories</h2>
      <ul className="mt-2 space-y-0.5">
        <li>
          <Link href={href(undefined)} aria-current={!active ? "page" : undefined} className={row(!active)}>
            All products <span className="text-xs text-slate-500">{total}</span>
          </Link>
        </li>
        {tops.map((t) => {
          const kids = items.filter((c) => c.parentId === t.id);
          return (
            <li key={t.id}>
              {kids.length === 0 ? (
                <Link href={href(t.slug)} aria-current={t.slug === active ? "page" : undefined} className={row(t.slug === active)}>
                  {t.name} <span className="text-xs text-slate-500">{t.count}</span>
                </Link>
              ) : (
                <details open={openId === t.id} className="group">
                  <summary className={`${row(t.slug === active)} cursor-pointer list-none`}>
                    <span className="flex items-center gap-1.5">
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 6 6 6-6 6" /></svg>
                      {t.name}
                    </span>
                    <span className="text-xs text-slate-500">{t.count}</span>
                  </summary>
                  <ul className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
                    <li>
                      <Link href={href(t.slug)} aria-current={t.slug === active ? "page" : undefined} className={row(t.slug === active)}>
                        All {t.name.toLowerCase()}
                      </Link>
                    </li>
                    {kids.map((c) => (
                      <li key={c.id}>
                        <Link href={href(c.slug)} aria-current={c.slug === active ? "page" : undefined} className={row(c.slug === active)}>
                          {c.name} <span className="text-xs text-slate-500">{c.count}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Removable tags for the filters in use. */
export function ActiveFilters({ filters }: { filters: { label: string; clear: string }[] }) {
  if (filters.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Filters in use">
      {filters.map((f) => (
        <li key={f.label}>
          <Link href={f.clear} className="plain inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1 text-sm text-white hover:bg-slate-700">
            {f.label}
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 6l12 12M18 6 6 18" /></svg>
            <span className="sr-only">(remove)</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
