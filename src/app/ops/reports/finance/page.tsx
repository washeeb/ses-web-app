import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { parseRange, paymentsReport, receivablesAging, taxReport } from "@/server/modules/analytics";
import { BarList } from "@/components/bar-list";
import { Kpi, RangePicker } from "@/components/charts";
import { Card, EmptyState, Money, PageHeader, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "Finance & tax" };

export default async function FinanceReportPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "finance.read")) return <EmptyState title="You can't open this page" />;
  const sp = await searchParams;
  const r = parseRange(sp);
  const db = getDb();
  const [tax, pay, aging] = await Promise.all([taxReport(db, actor, r), paymentsReport(db, actor, r), receivablesAging(db, actor)]);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const received = pay.reduce((a, p) => a + p.value, 0);
  return (
    <>
      <PageHeader title="Finance & tax" description={`${r.label}. Taxes are those charged on invoices issued in the period (void excluded) — the figures for the GRA VAT / NHIL / GETFund return. Confirm the return with your accountant.`} />
      <RangePicker sp={sp} csvHref={`/api/reports/tax?${qs}`} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Taxable sales (net)" value={<Money minor={tax.totals.net} />} />
        <Kpi label="Taxes charged" value={<Money minor={tax.totals.tax} />} />
        <Kpi label="Payments received" value={<Money minor={received} />} />
        <Kpi label="Owed to us now" value={<Money minor={aging.total} />} hint={`${aging.invoices.length} unpaid invoice(s)`} />
      </div>
      <Card title="Taxes by month" className="mb-6">
        {tax.months.length === 0 ? <EmptyState title="No invoices in this period" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Month</th><th className="text-right">Net sales</th>{tax.codes.map((c) => <th key={c.code} className="text-right">{c.name}</th>)}<th className="text-right">Total tax</th></tr></thead>
              <tbody>
                {tax.months.map((m) => (
                  <tr key={m.month}><td>{m.month}</td><td className="text-right tabular-nums"><Money minor={m.net} /></td>{tax.codes.map((c) => <td key={c.code} className="text-right tabular-nums"><Money minor={m.taxes[c.code] ?? 0} /></td>)}<td className="text-right font-semibold tabular-nums"><Money minor={m.total} /></td></tr>
                ))}
              </tbody>
              <tfoot><tr><th>Total</th><th className="text-right tabular-nums"><Money minor={tax.totals.net} /></th>{tax.codes.map((c) => <th key={c.code} className="text-right tabular-nums"><Money minor={tax.totals.byCode[c.code] ?? 0} /></th>)}<th className="text-right tabular-nums"><Money minor={tax.totals.tax} /></th></tr></tfoot>
            </table>
          </TableWrap>
        )}
      </Card>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Payments received by method"><BarList data={pay.map((p) => ({ label: `${p.label} (${p.count})`, value: p.value }))} money label="Payments by method" /></Card>
        <Card title="Unpaid invoices by age">
          <BarList data={aging.buckets.map((b) => ({ label: `${b.label} (${b.count})`, value: b.value }))} money label="Receivables by age" empty="Nothing is owed." />
          {aging.invoices.filter((i) => i.daysOverdue > 0).length > 0 && (
            <ul className="mt-4 space-y-1 text-sm">
              {aging.invoices.filter((i) => i.daysOverdue > 0).slice(0, 10).map((i) => (
                <li key={i.id} className="flex justify-between gap-2"><Link href={`/ops/invoices/${i.id}`} className="text-teal-700 hover:underline">{i.number} · {i.billTo}</Link><span className="tabular-nums"><Money minor={i.balance} /> · {i.daysOverdue} d late</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
