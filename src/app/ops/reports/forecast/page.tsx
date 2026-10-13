import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { forecastReport } from "@/server/modules/analytics";
import { Sparkline } from "@/components/charts";
import { Card, DateTime, EmptyState, PageHeader, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "Demand forecast" };

export default async function ForecastPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "inventory.read")) return <EmptyState title="You can't open this page" />;
  const f = await forecastReport(getDb(), actor);
  return (
    <>
      <PageHeader
        title="Demand forecast"
        description={`For SES-held stock (partners plan their own). Next week's demand per item from the last ${f.weeks} weeks of fulfilments, following any upward or downward trend (double exponential smoothing). Safety stock covers ups and downs over the supplier lead time at a 95% service level. Suggested order = enough for lead time plus two weeks, less what is available and already on order.`}
        actions={<a className="btn btn-ghost print:hidden" href={`/api/reports/forecast`} download>Export CSV</a>}
      />
      <Card>
        {f.rows.length === 0 ? <EmptyState title="No sales history yet">Forecasts appear once items have sold.</EmptyState> : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th><th>Last {f.weeks} weeks</th><th className="text-right">Forecast / week</th><th className="text-right">Available</th><th className="text-right">On order</th>
                  <th className="text-right">Runs out</th><th className="text-right">Reorder point (yours → suggested)</th><th className="text-right">Order now</th>
                </tr>
              </thead>
              <tbody>
                {f.rows.map((x) => (
                  <tr key={x.variantId}>
                    <td><Link href={`/ops/catalogue/${x.productId}`} className="text-teal-700 hover:underline">{x.name}</Link><span className="block font-mono text-xs text-slate-600">{x.sku} · lead time {x.leadTimeDays ?? 7} d</span></td>
                    <td><Sparkline values={x.weekly} /><span className="sr-only">{x.weekly.join(", ")}</span></td>
                    <td className="text-right tabular-nums">{x.forecastWeekly}{x.trend !== 0 && <span className={`ml-1 text-xs ${x.trend > 0 ? "text-emerald-700" : "text-red-700"}`}>{x.trend > 0 ? "▲" : "▼"}</span>}</td>
                    <td className="text-right tabular-nums">{x.available}</td>
                    <td className="text-right tabular-nums">{x.onOrder || "—"}</td>
                    <td className="text-right text-xs">{x.stockoutDate ? <DateTime value={x.stockoutDate} dateOnly /> : "—"}</td>
                    <td className="text-right tabular-nums">{x.reorderPoint ?? "—"} → <strong>{x.suggestedReorderPoint}</strong></td>
                    <td className={`text-right tabular-nums font-semibold ${x.suggestedOrder > 0 ? "text-teal-800" : "text-slate-500"}`}>{x.suggestedOrder || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <p className="mt-3 text-xs text-slate-600">Forecasts are a guide: adjust for seasons, promotions and school terms. Update reorder points and lead times in each product&apos;s stock settings; <Link href="/ops/inventory/reorder" className="text-teal-700 underline">Reorder</Link> drafts purchase orders.</p>
      </Card>
    </>
  );
}
