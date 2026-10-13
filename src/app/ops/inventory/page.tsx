import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listLocations, stockOverview } from "@/server/modules/inventory";
import { listCategoriesTree } from "@/server/modules/taxonomy";
import { Badge, Card, EmptyState, Money, PageHeader, Stat, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Stock levels" };

type SP = { q?: string; location?: string; category?: string; low?: string };

export default async function StockPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "inventory.read")) return <EmptyState title="You can't open this page" />;
  const sp = await searchParams;
  const db = getDb();
  const [rows, locations, cats] = await Promise.all([
    stockOverview(db, actor, { q: sp.q, locationId: sp.location || undefined, categoryId: sp.category || undefined, lowOnly: sp.low === "1" }),
    listLocations(db),
    listCategoriesTree(db),
  ]);
  const shown = locations.filter((l) => l.active && !l.connectionId && (!sp.location || l.id === sp.location));
  const value = rows.reduce((a, r) => a + r.valueMinor, 0);
  const units = rows.reduce((a, r) => a + r.onHand, 0);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader
        title="Stock levels"
        description="Every stock-tracked item by SES location, plus fresh partner stock. Available = sellable SES stock and fresh partner stock, minus reservations. Value is SES-held stock at average cost."
        actions={
          <>
            <LiveRefresh topics={["stock"]} />
            {can(actor, "data.export") && <a className="btn btn-ghost" href={`/api/exports/stock${qs ? `?${qs}` : ""}`} download>Export CSV</a>}
            {can(actor, "inventory.adjust") && <Link href="/ops/inventory/receive" className="btn btn-primary">Receive or adjust</Link>}
          </>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Items" value={rows.length} />
        <Stat label="Units on hand" value={units.toLocaleString("en-GH")} />
        <Stat label="Stock value (at cost)" value={<Money minor={value} />} />
      </div>
      <form role="search" className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto_auto]">
        <label className="sr-only" htmlFor="q">Search</label>
        <input id="q" name="q" type="search" className="field" placeholder="SKU, barcode or name" defaultValue={sp.q} />
        <label className="sr-only" htmlFor="location">Location</label>
        <select id="location" name="location" className="field" defaultValue={sp.location ?? ""}>
          <option value="">All locations</option>
          {locations.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>{l.name}{l.connectionId ? " (partner)" : ""}</option>)}
        </select>
        <label className="sr-only" htmlFor="category">Category</label>
        <select id="category" name="category" className="field" defaultValue={sp.category ?? ""}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.depth ? "— " : ""}{c.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="low" value="1" defaultChecked={sp.low === "1"} /> Low or out only</label>
        <button className="btn btn-primary" type="submit">Show</button>
      </form>
      <Card>
        {rows.length === 0 ? <EmptyState title="Nothing to show">Products that track stock appear here.</EmptyState> : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  {shown.map((l) => <th key={l.id} className="text-right">{l.name}{l.sellable ? "" : " *"}</th>)}
                  <th className="text-right">Partner</th>
                  <th className="text-right">Reserved</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">Reorder at</th>
                  <th className="text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.variantId}>
                    <td>
                      <Link href={`/ops/catalogue/${r.productId}`} className="font-medium text-teal-700 hover:underline">{r.name}</Link>
                      <span className="block font-mono text-xs text-slate-600">{r.sku}{r.serialTracked && <Badge tone="purple">serials</Badge>}</span>
                    </td>
                    {shown.map((l) => <td key={l.id} className="text-right tabular-nums">{r.levels.find((x) => x.locationId === l.id)?.onHand ?? 0}</td>)}
                    <td className="text-right tabular-nums text-slate-600">{r.partnerAvailable || "—"}</td>
                    <td className="text-right tabular-nums">{r.reserved}</td>
                    <td className="text-right tabular-nums"><span className="mr-2">{r.available}</span><StatusBadge status={r.status} /></td>
                    <td className="text-right tabular-nums">{r.reorderPoint ?? "—"}{r.reorder && <span className="ml-1"><Badge tone="red">reorder</Badge></span>}</td>
                    <td className="text-right tabular-nums">{r.costMinor === null ? <span className="text-xs text-slate-500">no cost</span> : <Money minor={r.valueMinor} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {shown.some((l) => !l.sellable) && <p className="mt-3 text-xs text-slate-600">* Not for sale: stock there is not offered in the shop or to Synclytics.</p>}
      </Card>
    </>
  );
}
