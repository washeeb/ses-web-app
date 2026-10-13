import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { parseRange, productPerformance } from "@/server/modules/analytics";
import { BarList } from "@/components/bar-list";
import { RangePicker } from "@/components/charts";
import { Badge, Card, EmptyState, Money, PageHeader, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "Product performance" };

export default async function ProductsReportPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const actor = await requireActor("operator");
  const sp = await searchParams;
  const r = parseRange(sp);
  const p = await productPerformance(getDb(), actor, r);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Product performance" description={`${r.label}. From completed orders. ABC: A = the items making the first 80% of sales (keep them in stock), B = the next 15%, C = the rest.`} />
      <RangePicker sp={sp} csvHref={`/api/reports/products?${qs}`} />
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card title="By category"><BarList data={p.byCategory.map((c) => ({ label: c.label, value: c.revenue }))} money label="Sales by category" /></Card>
        <Card title="By brand"><BarList data={p.byBrand.map((c) => ({ label: c.label, value: c.revenue }))} money label="Sales by brand" /></Card>
      </div>
      <Card title="Items">
        {p.rows.length === 0 ? <EmptyState title="No completed orders in this period" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Item</th><th>Class</th><th className="text-right">Units</th><th className="text-right">Sales</th><th className="text-right">Cost</th><th className="text-right">Margin</th><th className="text-right">Margin %</th></tr></thead>
              <tbody>
                {p.rows.map((x) => (
                  <tr key={x.variantId}>
                    <td>{x.name}<span className="block font-mono text-xs text-slate-600">{x.sku}{x.categoryName ? ` · ${x.categoryName}` : ""}</span></td>
                    <td><Badge tone={x.abc === "A" ? "green" : x.abc === "B" ? "amber" : "gray"}>{x.abc}</Badge></td>
                    <td className="text-right tabular-nums">{x.qty}</td>
                    <td className="text-right tabular-nums"><Money minor={x.revenue} /></td>
                    <td className="text-right tabular-nums">{x.cost === null ? "—" : <Money minor={x.cost} />}</td>
                    <td className="text-right tabular-nums">{x.margin === null ? "—" : <Money minor={x.margin} />}</td>
                    <td className={`text-right tabular-nums ${x.marginPct !== null && x.marginPct < 10 ? "text-red-700" : ""}`}>{x.marginPct === null ? "—" : `${x.marginPct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <p className="mt-3 text-xs text-slate-600">Cost is the average cost when each unit left SES stock, or the partner&apos;s latest cost for partner-fulfilled lines. Services, licences and subscriptions have no stock cost. Low margins (under 10%) are in red. <Link href="/ops/inventory" className="text-teal-700 underline">Stock levels</Link></p>
      </Card>
    </>
  );
}
