import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { listCategories, listStoreProducts, PRODUCT_TYPE_LABEL, PRODUCT_TYPES } from "@/server/modules/catalogue";
import { Badge, DemoNotice, EmptyState, Money } from "@/components/ui";
import { AvailabilityBadge } from "@/components/availability";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Store" };

export default async function StorePage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string; category?: string }> }) {
  const sp = await searchParams;
  const db = getDb();
  const [items, cats] = await Promise.all([listStoreProducts(db, { q: sp.q, type: sp.type, category: sp.category }), listCategories(db)]);
  const anyDemo = items.some((i) => i.isDemo);
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Store</h1>
          <p className="mt-1 text-slate-600">Hardware, software licences, subscriptions and service packages. Prices in GHS.</p>
        </div>
        <LiveRefresh topics={["catalogue", "stock"]} />
      </div>
      {anyDemo && (
        <div className="mt-4">
          <DemoNotice>Listings marked “Demonstration” are sample products and prices. Online checkout opens in a later release; request a quotation to buy.</DemoNotice>
        </div>
      )}
      <form className="mt-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-[2fr_1fr_1fr_auto]" role="search">
        <label className="sr-only" htmlFor="q">Search products</label>
        <input id="q" name="q" defaultValue={sp.q} placeholder="Search products" className="field" />
        <label className="sr-only" htmlFor="type">Type</label>
        <select id="type" name="type" defaultValue={sp.type ?? ""} className="field">
          <option value="">All types</option>
          {PRODUCT_TYPES.map((t) => (
            <option key={t} value={t}>{PRODUCT_TYPE_LABEL[t]}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="category">Category</label>
        <select id="category" name="category" defaultValue={sp.category ?? ""} className="field">
          <option value="">All categories</option>
          {cats.map((c) => (
            <option key={c.id} value={c.slug}>{c.name}</option>
          ))}
        </select>
        <button className="btn btn-primary" type="submit">Filter</button>
      </form>

      {items.length === 0 ? (
        <div className="mt-8">
          <EmptyState title="No products match">Try a different search or clear the filters.</EmptyState>
        </div>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => {
            const from = p.variants[0]!;
            return (
              <li key={p.id} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="blue">{PRODUCT_TYPE_LABEL[p.type]}</Badge>
                  {p.isDemo && <Badge tone="amber">Demonstration</Badge>}
                </div>
                <h2 className="mt-3 text-lg font-semibold">
                  <Link href={`/store/${p.slug}`} className="hover:text-teal-700">{p.name}</Link>
                </h2>
                <p className="mt-1 flex-1 text-sm text-slate-600">{p.summary}</p>
                <div className="mt-4 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-xs text-slate-500">{p.variants.length > 1 ? "From" : "Price"}</p>
                    <p className="font-semibold">
                      <Money minor={from.priceMinor} currency={from.currency} />
                      {from.billingPeriod && <span className="text-sm font-normal text-slate-500"> / {from.billingPeriod}</span>}
                    </p>
                  </div>
                  <AvailabilityBadge a={from.availability} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
