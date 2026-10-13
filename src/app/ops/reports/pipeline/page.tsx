import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { parseRange, pipelineReport } from "@/server/modules/analytics";
import { Kpi, RangePicker } from "@/components/charts";
import { Card, EmptyState, Money, PageHeader, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "Leads & quotations" };

function LeadTable({ rows, label }: { rows: { label: string; leads: number; won: number; lost: number; winRate: number | null }[]; label: string }) {
  if (rows.length === 0) return <EmptyState title="No leads in this period" />;
  return (
    <TableWrap label={label}>
      <table className="table">
        <thead><tr><th>{label}</th><th className="text-right">Leads</th><th className="text-right">Won</th><th className="text-right">Lost</th><th className="text-right">Win rate</th></tr></thead>
        <tbody>{rows.map((x) => <tr key={x.label}><td>{x.label}</td><td className="text-right tabular-nums">{x.leads}</td><td className="text-right tabular-nums">{x.won}</td><td className="text-right tabular-nums">{x.lost}</td><td className="text-right tabular-nums">{x.winRate === null ? "—" : `${x.winRate}%`}</td></tr>)}</tbody>
      </table>
    </TableWrap>
  );
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const actor = await requireActor("operator");
  const sp = await searchParams;
  const r = parseRange(sp);
  const p = await pipelineReport(getDb(), actor, r);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Leads & quotations" description={`${r.label}. Lead win rate = won ÷ (won + lost). Quotation win rate = accepted ÷ sent.`} />
      <RangePicker sp={sp} csvHref={`/api/reports/pipeline?${qs}`} />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="New leads" value={p.totals.leads} />
        <Kpi label="Quotations created" value={p.totals.quotes} hint={`${p.totals.sent} sent`} />
        <Kpi label="Quotations won" value={p.totals.won} hint={p.totals.winRate === null ? undefined : `${p.totals.winRate}% of those sent`} />
        <Kpi label="Won value" value={<Money minor={p.totals.wonValue} />} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="By lead source"><LeadTable rows={p.bySource} label="Source" /></Card>
        <Card title="By service of interest"><LeadTable rows={p.byInterest} label="Service" /></Card>
      </div>
    </>
  );
}
