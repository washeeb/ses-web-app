import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { parseRange, salesReport, topCustomers } from "@/server/modules/analytics";
import { BarList } from "@/components/bar-list";
import { Kpi, LineChart, RangePicker } from "@/components/charts";
import { Card, EmptyState, Money, PageHeader, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "Sales report" };

type SP = { range?: string; from?: string; to?: string };

export default async function SalesReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor("operator");
  const sp = await searchParams;
  const r = parseRange(sp);
  const db = getDb();
  const [s, customers] = await Promise.all([salesReport(db, actor, r), topCustomers(db, actor, r)]);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Sales" description={`${r.label}. Sales are invoices issued (excluding void), after discounts and before taxes. Margin is on stock items: SES stock at average cost, partner-fulfilled lines at the partner's latest cost.`} />
      <RangePicker sp={sp} csvHref={`/api/reports/sales?${qs}`} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Net sales" value={<Money minor={s.kpis.net.value} />} change={s.kpis.net.change} />
        <Kpi label="Invoices" value={s.kpis.invoices.value} change={s.kpis.invoices.change} />
        <Kpi label="Average invoice" value={<Money minor={s.kpis.average.value} />} change={s.kpis.average.change} />
        <Kpi label="Gross margin (stock items)" value={<Money minor={s.kpis.margin.value} />} change={s.kpis.margin.change} hint={s.kpis.marginPct === null ? "No stock items sold" : `${s.kpis.marginPct}% of their sales · ${s.kpis.unitsSold} units`} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card title={`Net sales by ${s.unit}`}>
          <LineChart series={s.series} unit={s.unit} money label="Net sales" />
        </Card>
        <Card title="By channel">
          <BarList data={s.channels.map((c) => ({ label: `${c.label} (${c.count})`, value: c.value }))} money label="Net sales by channel" />
          <p className="mt-4 text-sm text-slate-600">Taxes charged: <strong><Money minor={s.kpis.tax.value} /></strong> — see <Link href={`/ops/reports/finance?${qs}`} className="text-teal-700 underline">Finance &amp; tax</Link>.</p>
        </Card>
      </div>
      <Card title="Top customers" className="mt-6">
        {customers.length === 0 ? <EmptyState title="No invoiced customers in this period" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Customer</th><th className="text-right">Invoices</th><th className="text-right">Net sales</th></tr></thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/ops/customers/${c.id}`} className="text-teal-700 hover:underline">{c.name}</Link></td>
                    <td className="text-right tabular-nums">{c.invoices}</td>
                    <td className="text-right tabular-nums"><Money minor={c.net} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
