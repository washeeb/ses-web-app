import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { parseRange, purchasingReport } from "@/server/modules/analytics";
import { Kpi, RangePicker } from "@/components/charts";
import { Card, EmptyState, Money, PageHeader, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "Procurement report" };

export default async function PurchasingReportPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "procurement.read")) return <EmptyState title="You can't open this page" />;
  const sp = await searchParams;
  const r = parseRange(sp);
  const p = await purchasingReport(getDb(), actor, r);
  return (
    <>
      <PageHeader title="Procurement" description={`${r.label}. Spend = stock received against purchase orders (goods receipts), at the order's unit cost. On time = first delivery by the expected date (plus one day).`} />
      <RangePicker sp={sp} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Received (at cost)" value={<Money minor={p.spend} />} />
        <Kpi label="Open purchase orders" value={p.openOrders.count} />
        <Kpi label="Value still on order" value={<Money minor={p.openOrders.value} />} />
      </div>
      <Card title="By supplier">
        {p.bySupplier.length === 0 ? <EmptyState title="Nothing received in this period" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Supplier</th><th className="text-right">Units received</th><th className="text-right">Value</th><th className="text-right">On time</th></tr></thead>
              <tbody>{p.bySupplier.map((s) => <tr key={s.label}><td>{s.label}</td><td className="text-right tabular-nums">{s.units}</td><td className="text-right tabular-nums"><Money minor={s.value} /></td><td className={`text-right tabular-nums ${s.onTimePct !== null && s.onTimePct < 80 ? "text-red-700" : ""}`}>{s.onTimePct === null ? "—" : `${s.onTimePct}%`}</td></tr>)}</tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
