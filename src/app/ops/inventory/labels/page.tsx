import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { findVariantByCode, itemOptions } from "@/server/modules/inventory";
import { code128Svg } from "@/server/lib/code128";
import { formatMoney } from "@/server/lib/money";
import { getSettings } from "@/server/modules/settings";
import { eq } from "drizzle-orm";
import { products } from "@/server/db/schema";
import { ItemDatalist, ItemRows } from "@/components/stock-ui";
import { PrintButton } from "@/components/print-button";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Labels" };

type Label = { sku: string; name: string; price: string; svg: string };

/**
 * Shelf and product labels with a Code 128 barcode of the SKU (scanners read it back as the SKU). Laid out for
 * A4 sheets of 21 labels (63.5 × 38.1 mm, e.g. Avery L7160); any printer works, or print on plain paper and cut.
 */
export default async function LabelsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "inventory.read")) return <EmptyState title="You can't open this page" />;
  const sp = await searchParams;
  const db = getDb();
  const [items, settings] = await Promise.all([itemOptions(db), getSettings(db)]);
  const labels: Label[] = [];
  const problems: string[] = [];
  for (let i = 0; i < 20; i++) {
    const code = sp[`code_${i}`]?.split(" — ")[0]?.trim();
    if (!code) continue;
    const qty = Math.min(Math.max(1, Number(sp[`qty_${i}`]) || 1), 210);
    const v = await findVariantByCode(db, code);
    if (!v) {
      problems.push(code);
      continue;
    }
    const [p] = await db.select({ name: products.name }).from(products).where(eq(products.id, v.productId));
    const svg = code128Svg(v.sku, { height: 48, moduleWidth: 1.6 }).svg;
    for (let n = 0; n < qty; n++) labels.push({ sku: v.sku, name: v.name === "Standard" ? p!.name : `${p!.name} — ${v.name}`, price: formatMoney(v.priceMinor, v.currency), svg });
  }
  const showPrice = sp.price !== "0";
  return (
    <>
      <div className="print:hidden">
        <PageHeader title="Labels" description="Print barcode labels for shelves and products. Scanning a label finds the item by its SKU." actions={labels.length > 0 ? <PrintButton label={`Print ${labels.length} label${labels.length === 1 ? "" : "s"}`} /> : undefined} />
        <Card title="Choose items" className="mb-6">
          <form method="get" className="space-y-4">
            <ItemDatalist items={items} />
            <ItemRows count={6} defaults={Array.from({ length: 6 }, (_, i) => ({ code: sp[`code_${i}`] ?? "", qty: sp[`qty_${i}`] ? Number(sp[`qty_${i}`]) : undefined }))} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="price" value="0" defaultChecked={!showPrice} /> Leave the price off</label>
            <button className="btn btn-primary" type="submit">Show labels</button>
          </form>
          {problems.length > 0 && <p role="alert" className="mt-3 text-sm text-red-700">Not found: {problems.join(", ")}</p>}
        </Card>
      </div>
      {labels.length > 0 && (
        <div className="label-sheet grid grid-cols-2 gap-2 sm:grid-cols-3 print:gap-0" aria-label="Labels to print">
          {labels.map((l, i) => (
            <div key={i} className="label flex flex-col justify-between overflow-hidden rounded border border-slate-300 bg-white p-2 print:rounded-none print:border-0">
              <p className="line-clamp-2 text-xs font-semibold leading-tight text-slate-900">{l.name}</p>
              <div className="flex items-end justify-between gap-1">
                <p className="text-[10px] text-slate-700">{settings.companyName}</p>
                {showPrice && <p className="text-sm font-bold text-slate-900">{l.price}</p>}
              </div>
              {/* SVG built from the SKU by our own encoder (bars only, no text). */}
              <div className="mt-1 h-10 [&>svg]:h-full [&>svg]:w-full" role="img" aria-label={`Barcode ${l.sku}`} dangerouslySetInnerHTML={{ __html: l.svg }} />
              <p className="text-center font-mono text-[10px] tracking-wider">{l.sku}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
