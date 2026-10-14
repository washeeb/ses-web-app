import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { listStoreProducts, PRODUCT_TYPE_LABEL, PRODUCT_TYPES, type StoreSort } from "@/server/modules/catalogue";
import { listBrands, listCategoriesTree, listTags } from "@/server/modules/taxonomy";
import { Badge, DemoNotice, EmptyState, Money } from "@/components/ui";
import { AvailabilityBadge } from "@/components/availability";
import { LiveRefresh } from "@/components/live-refresh";
import { NoPicture, Picture } from "@/components/picture";
import { mainImages } from "@/server/modules/media";

export const metadata: Metadata = { title: "Store", description: "Hardware, software licences, subscriptions and service packages from Synclytics Enterprise Systems." };

const SORTS: { value: StoreSort; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "newest", label: "Newest" },
];

type SP = { q?: string; type?: string; category?: string; brand?: string; tag?: string; sort?: string };

export default async function StorePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const sort = (SORTS.find((s) => s.value === sp.sort)?.value ?? "name") as StoreSort;
  const db = getDb();
  const [items, cats, brands, tags] = await Promise.all([
    listStoreProducts(db, { q: sp.q, type: sp.type, category: sp.category, brand: sp.brand, tag: sp.tag, sort }),
    listCategoriesTree(db),
    listBrands(db),
    listTags(db),
  ]);
  const shownCats = cats.filter((c) => c.active);
  const shownBrands = brands.filter((b) => b.active && b.productCount > 0);
  const activeTag = sp.tag ? tags.find((t) => t.slug === sp.tag) : null;
  const activeCat = cats.find((c) => c.slug === sp.category);
  const catImages = await mainImages(db, "category", shownCats.map((c) => c.id));
  const activeCatImage = activeCat ? catImages.get(activeCat.id) : undefined;
  const browsing = !sp.q && !sp.type && !sp.category && !sp.brand && !sp.tag;
  const topCats = shownCats.filter((c) => c.depth === 0 && catImages.has(c.id));
  const anyDemo = items.some((i) => i.isDemo);
  const link = (change: Partial<SP>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...change })) if (v) next.set(k, v);
    const qs = next.toString();
    return qs ? `/store?${qs}` : "/store";
  };
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">{activeCat?.name ?? "Store"}</h1>
          <p className="mt-1 max-w-2xl text-slate-600">{activeCat?.description || "Hardware, software licences, subscriptions and service packages. Prices in GHS."}</p>
        </div>
        <div className="flex items-end gap-4">
          <LiveRefresh topics={["catalogue", "stock"]} />
          {activeCatImage && <Picture m={activeCatImage} sizes="240px" fallbackWidth={320} priority className="hidden aspect-[3/2] w-60 rounded-xl object-cover sm:block" alt="" />}
        </div>
      </div>
      {browsing && topCats.length > 0 && (
        <section className="mt-6" aria-labelledby="by-category">
          <h2 id="by-category" className="text-lg font-semibold text-slate-900">Shop by category</h2>
          <ul className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {topCats.map((c) => (
              <li key={c.id}>
                <Link href={link({ category: c.slug })} className="group block overflow-hidden rounded-xl border border-slate-200 bg-white hover:border-teal-700">
                  <Picture m={catImages.get(c.id)!} sizes="(min-width: 1024px) 180px, (min-width: 768px) 30vw, 45vw" fallbackWidth={320} className="aspect-[3/2] w-full object-cover" alt="" />
                  <span className="block px-3 py-2 text-sm font-semibold text-slate-900 group-hover:text-teal-700">{c.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {anyDemo && (
        <div className="mt-4">
          <DemoNotice>Listings marked “Demonstration” are sample products and prices for evaluation.</DemoNotice>
        </div>
      )}
      <div className="mt-6 grid gap-8 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Store categories" className="text-sm">
          <h2 className="font-semibold text-slate-900">Categories</h2>
          <ul className="mt-2 space-y-0.5">
            <li><Link href={link({ category: undefined })} aria-current={!sp.category ? "page" : undefined} className={`block rounded px-2 py-1 ${!sp.category ? "bg-teal-50 font-semibold text-teal-900" : "hover:bg-slate-100"}`}>All products</Link></li>
            {shownCats.map((c) => (
              <li key={c.id}>
                <Link
                  href={link({ category: c.slug })}
                  aria-current={sp.category === c.slug ? "page" : undefined}
                  className={`block rounded px-2 py-1 ${c.depth ? "pl-5" : ""} ${sp.category === c.slug ? "bg-teal-50 font-semibold text-teal-900" : "hover:bg-slate-100"}`}
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <form className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]" role="search">
            {sp.category && <input type="hidden" name="category" value={sp.category} />}
            {sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
            <label className="sr-only" htmlFor="q">Search products</label>
            <input id="q" name="q" type="search" defaultValue={sp.q} placeholder="Search name, brand or SKU" className="field" />
            <label className="sr-only" htmlFor="type">Type</label>
            <select id="type" name="type" defaultValue={sp.type ?? ""} className="field">
              <option value="">All types</option>
              {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{PRODUCT_TYPE_LABEL[t]}</option>)}
            </select>
            <label className="sr-only" htmlFor="brand">Brand</label>
            <select id="brand" name="brand" defaultValue={sp.brand ?? ""} className="field">
              <option value="">All brands</option>
              {shownBrands.map((b) => <option key={b.id} value={b.slug}>{b.name}</option>)}
            </select>
            <label className="sr-only" htmlFor="sort">Sort by</label>
            <select id="sort" name="sort" defaultValue={sort} className="field">
              {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button className="btn btn-primary" type="submit">Filter</button>
          </form>
          {activeTag && (
            <p className="mt-3 text-sm">
              Tagged <Badge tone="teal">{activeTag.name}</Badge> <Link href={link({ tag: undefined })} className="ml-1 text-teal-700 underline">clear</Link>
            </p>
          )}
          <p className="mt-4 text-sm text-slate-600" aria-live="polite">{items.length} product{items.length === 1 ? "" : "s"}</p>
          {items.length === 0 ? (
            <div className="mt-4">
              <EmptyState title="No products match">Try a different search or clear the filters.</EmptyState>
            </div>
          ) : (
            <ul className="mt-4 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((p, i) => {
                const from = p.variants[0]!;
                return (
                  <li key={p.id} className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <Link href={`/store/${p.slug}`} tabIndex={-1} aria-hidden="true">
                      {p.image ? (
                        <Picture m={p.image} sizes="(min-width: 1280px) 300px, (min-width: 640px) 45vw, 100vw" fallbackWidth={800} priority={i < 3} className="aspect-[4/3] w-full bg-slate-50 object-contain" alt="" />
                      ) : (
                        <NoPicture label={p.name} className="aspect-[4/3] w-full" />
                      )}
                    </Link>
                    <div className="flex flex-1 flex-col p-5">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone="blue">{PRODUCT_TYPE_LABEL[p.type]}</Badge>
                        {p.brandName && <Badge>{p.brandName}</Badge>}
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
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
