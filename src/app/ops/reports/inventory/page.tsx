import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { inventoryReport, parseRange } from "@/server/modules/analytics";
import { MOVEMENT_LABELS } from "@/server/modules/inventory";
import { BarList } from "@/components/bar-list";
import { Kpi, RangePicker } from "@/components/charts";
import { Card, DateTime, EmptyState, Money, PageHeader, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "Inventory report" };

export default async function InventoryReportPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "inventory.read")) return <EmptyState title="You can't open this page" />;
  const sp = await searchParams;
  const r = parseRange(sp);
  const x = await inventoryReport(getDb(), actor, r);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Inventory health" description="Stock value and how fast it turns, items that have stopped selling, and stock lost or corrected. Value and turnover are as of today; losses are for the chosen period." />
      <RangePicker sp={sp} csvHref={`/api/reports/inventory?${qs}`} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Stock value (at cost)" value={<Money minor={x.value} />} />
        <Kpi label="Units on hand" value={x.units.toLocaleString("en-GH")} />
        <Kpi label="Stock turns a year" value={x.turnover ?? "—"} hint="Cost of sales (last 90 days, annualised) ÷ stock value" />
        <Kpi label="Out of stock" value={x.outOfStock} />
      </div>
      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Card title="Value by category"><BarList data={x.byCategory.map((c) => ({ label: c.label, value: c.value }))} money label="Stock value by category" /></Card>
        <Card title="Value by location"><BarList data={x.byLocation} money label="Stock value by location" /></Card>
        <Card title={`Losses and corrections (${r.label.toLowerCase()})`}>
          {x.losses.length === 0 ? <p className="text-sm text-slate-600">None recorded.</p> : (
            <ul className="space-y-1 text-sm">
              {x.losses.map((l) => (
                <li key={l.reason} className="flex justify-between gap-2"><span>{MOVEMENT_LABELS[l.reason] ?? l.reason} ({l.units > 0 ? "−" : "+"}{Math.abs(l.units)})</span><span className={`tabular-nums ${l.value > 0 ? "text-red-700" : "text-emerald-700"}`}><Money minor={-l.value} /></span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Running low (14 days of cover or less)">
          {x.lowCover.length === 0 ? <p className="text-sm text-slate-600">Nothing is about to run out at the current rate of sale.</p> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Item</th><th className="text-right">Available</th><th className="text-right">Sold / day</th><th className="text-right">Days left</th></tr></thead>
                <tbody>{x.lowCover.slice(0, 30).map((i) => <tr key={i.variantId}><td><Link href={`/ops/catalogue/${i.productId}`} className="text-teal-700 hover:underline">{i.name}</Link></td><td className="text-right">{i.available}</td><td className="text-right">{i.dailyDemand}</td><td className="text-right font-semibold">{i.daysOfCover}</td></tr>)}</tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        <Card title="Not selling (no sale in 90 days)">
          {x.dead.length === 0 ? <p className="text-sm text-slate-600">Everything in stock has sold in the last 90 days.</p> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Item</th><th className="text-right">On hand</th><th className="text-right">Value</th><th>Last sold</th></tr></thead>
                <tbody>{x.dead.slice(0, 30).map((i) => <tr key={i.variantId}><td><Link href={`/ops/catalogue/${i.productId}`} className="text-teal-700 hover:underline">{i.name}</Link></td><td className="text-right">{i.onHand}</td><td className="text-right"><Money minor={i.valueMinor} /></td><td className="text-xs">{i.lastSale ? <DateTime value={i.lastSale} dateOnly /> : "never"}</td></tr>)}</tbody>
              </table>
            </TableWrap>
          )}
          <p className="mt-3 text-xs text-slate-600">Consider a promotion, a bundle, or returning slow stock to the supplier.</p>
        </Card>
      </div>
    </>
  );
}
