import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { getStoreProduct, PRODUCT_TYPE_LABEL } from "@/server/modules/catalogue";
import { Badge, DemoNotice, Money } from "@/components/ui";
import { AvailabilityBadge } from "@/components/availability";
import { LiveRefresh } from "@/components/live-refresh";
import { ActionForm } from "@/components/action-form";
import { addToCartAction } from "../cart-actions";

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getStoreProduct(getDb(), slug);
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <Link href="/store" className="hover:underline">Store</Link> / <span>{p.name}</span>
      </nav>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge tone="blue">{PRODUCT_TYPE_LABEL[p.type]}</Badge>
        {p.categoryName && <Badge>{p.categoryName}</Badge>}
        {p.isDemo && <Badge tone="amber">Demonstration</Badge>}
        <span className="ml-auto"><LiveRefresh topics={["catalogue", "stock"]} /></span>
      </div>
      <h1 className="mt-3 text-3xl font-bold text-slate-900">{p.name}</h1>
      {p.description && <p className="mt-3 whitespace-pre-line text-slate-700">{p.description}</p>}
      {p.isDemo && <div className="mt-4"><DemoNotice /></div>}

      <h2 className="mt-8 text-lg font-semibold">Options</h2>
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
      <p className="mt-3 text-xs text-slate-500">
        Stock shown as “to be confirmed” comes from a partner whose latest update is older than our freshness limit; we confirm it before accepting an order.
      </p>
    </div>
  );
}
