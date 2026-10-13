import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import { getDb } from "@/server/db/client";
import { getStoreProduct, PRODUCT_TYPE_LABEL } from "@/server/modules/catalogue";
import { Badge, DemoNotice, Money } from "@/components/ui";
import { AvailabilityBadge } from "@/components/availability";
import { LiveRefresh } from "@/components/live-refresh";
import { ActionForm } from "@/components/action-form";
import { imageSrc, NoPicture, pickWidth, Picture } from "@/components/picture";
import { addToCartAction } from "../cart-actions";

const load = cache(async (slug: string) => getStoreProduct(getDb(), slug));
const base = () => process.env.APP_URL ?? "http://localhost:3000";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: "Product" };
  const img = p.images[0];
  return {
    title: p.name,
    description: p.summary ?? undefined,
    alternates: { canonical: `/store/${p.slug}` },
    openGraph: { title: p.name, description: p.summary ?? undefined, images: img ? [{ url: `${base()}${imageSrc(img, pickWidth(img, 1200))}`, width: img.width, height: img.height, alt: img.alt || p.name }] : undefined },
  };
}

export default async function ProductPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ img?: string }> }) {
  const { slug } = await params;
  const p = await load(slug);
  if (!p) notFound();
  const shown = Math.min(Math.max(0, Number((await searchParams).img) || 0), Math.max(0, p.images.length - 1));
  const main = p.images[shown];
  // Structured data so search engines can show price and availability (schema.org Product).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.summary ?? p.description ?? undefined,
    image: p.images.map((m) => `${base()}${imageSrc(m, pickWidth(m, 1200))}`),
    sku: p.variants[0]?.sku,
    brand: p.brandName ? { "@type": "Brand", name: p.brandName } : undefined,
    category: p.categoryName ?? undefined,
    offers: p.variants.map((v) => ({
      "@type": "Offer",
      sku: v.sku,
      price: (v.priceMinor / 100).toFixed(2),
      priceCurrency: v.currency,
      availability: v.availability.purchasable ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: `${base()}/store/${p.slug}`,
    })),
  };
  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      {!p.isDemo && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />}
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <Link href="/store" className="hover:underline">Store</Link>
        {p.categorySlug && <> / <Link href={`/store?category=${p.categorySlug}`} className="hover:underline">{p.categoryName}</Link></>} / <span aria-current="page">{p.name}</span>
      </nav>
      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <div>
          {main ? (
            <Picture m={main} sizes="(min-width: 1024px) 560px, 100vw" fallbackWidth={800} priority className="aspect-square w-full rounded-xl border border-slate-200 bg-white object-contain" alt={main.alt || p.name} />
          ) : (
            <NoPicture label={p.name} className="aspect-square w-full rounded-xl" />
          )}
          {p.images.length > 1 && (
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="More pictures">
              {p.images.map((m, i) => (
                <li key={m.id}>
                  <Link href={`/store/${p.slug}?img=${i}`} scroll={false} aria-current={i === shown ? "true" : undefined} className={`block rounded-lg border-2 ${i === shown ? "border-teal-700" : "border-transparent hover:border-slate-300"}`}>
                    <Picture m={m} sizes="72px" fallbackWidth={320} className="h-16 w-16 rounded-md bg-white object-contain" alt={`Picture ${i + 1}${m.alt ? `: ${m.alt}` : ""}`} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="blue">{PRODUCT_TYPE_LABEL[p.type]}</Badge>
            {p.brandName && <Link href={`/store?brand=${p.brandSlug}`}><Badge>{p.brandName}</Badge></Link>}
            {p.isDemo && <Badge tone="amber">Demonstration</Badge>}
            <span className="ml-auto"><LiveRefresh topics={["catalogue", "stock"]} /></span>
          </div>
          <h1 className="mt-3 text-3xl font-bold text-slate-900">{p.name}</h1>
          {p.summary && <p className="mt-2 text-lg text-slate-700">{p.summary}</p>}
          {p.isDemo && <div className="mt-4"><DemoNotice /></div>}

          <h2 className="mt-6 text-lg font-semibold">Options</h2>
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {p.variants.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{v.name}</p>
                  <p className="text-xs text-slate-500">SKU {v.sku}</p>
                </div>
                <AvailabilityBadge a={v.availability} showCount />
                <div className="text-right">
                  <p className="font-semibold">
                    <Money minor={v.priceMinor} currency={v.currency} />
                    {v.billingPeriod && <span className="text-sm font-normal text-slate-500"> / {v.billingPeriod}</span>}
                  </p>
                  <p className="text-xs text-slate-500">excl. taxes</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {v.availability.purchasable && (
                    <ActionForm action={addToCartAction} inline submitLabel={<>Add to cart<span className="sr-only">: {v.name}</span></>} submitClassName="btn btn-accent">
                      <input type="hidden" name="variantId" value={v.id} />
                      <label htmlFor={`qty-${v.id}`} className="sr-only">Quantity of {v.name}</label>
                      <input id={`qty-${v.id}`} name="quantity" type="number" min={1} max={v.tracksStock ? Math.min(999, v.availability.available) : 999} defaultValue={1} className="field w-20" />
                    </ActionForm>
                  )}
                  <Link className="btn btn-ghost" href={`/contact?service=${encodeURIComponent("Store / products")}&product=${encodeURIComponent(`${p.name} — ${v.name} (${v.sku})`)}`}>
                    Request quotation<span className="sr-only">: {v.name}</span>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm"><Link href="/store/cart" className="font-medium text-teal-700 underline">View your cart</Link></p>
          {p.description && (
            <>
              <h2 className="mt-8 text-lg font-semibold">Description</h2>
              <p className="mt-2 whitespace-pre-line text-slate-700">{p.description}</p>
            </>
          )}
          {p.specs.length > 0 && (
            <>
              <h2 className="mt-8 text-lg font-semibold">Specifications</h2>
              <table className="mt-2 w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {p.specs.map((s) => (
                    <tr key={s.name}>
                      <th scope="row" className="w-2/5 py-2 pr-4 text-left font-medium text-slate-700">{s.name}</th>
                      <td className="py-2 text-slate-900">{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {p.tags.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-2" aria-label="Tags">
              {p.tags.map((t) => <li key={t.id}><Link href={`/store?tag=${t.slug}`} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-slate-200">#{t.name}</Link></li>)}
            </ul>
          )}
          <p className="mt-6 text-xs text-slate-500">
            Stock shown as “to be confirmed” comes from a partner whose latest update is older than our freshness limit; we confirm it before accepting an order.
          </p>
        </div>
      </div>
    </div>
  );
}
