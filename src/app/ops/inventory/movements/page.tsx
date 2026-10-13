import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listLocations, MOVEMENT_LABELS, searchMovements } from "@/server/modules/inventory";
import { Card, DateTime, EmptyState, Field, Money, PageHeader, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "Stock movements" };

type SP = { q?: string; reason?: string; location?: string; from?: string; to?: string; page?: string };
const PAGE = 100;
const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : undefined);

export default async function MovementsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "inventory.read")) return <EmptyState title="You can't open this page" />;
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page) || 0);
  const db = getDb();
  const to = day(sp.to);
  const [rows, locations] = await Promise.all([
    searchMovements(db, actor, { q: sp.q, reason: sp.reason || undefined, locationId: sp.location || undefined, from: day(sp.from), to: to && new Date(to.getTime() + 86_400_000), limit: PAGE + 1, offset: page * PAGE }),
    listLocations(db),
  ]);
  const filters = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]);
  const pageLink = (p: number) => `?${new URLSearchParams([...filters, ["page", String(p)]]).toString()}`;
  return (
    <>
      <PageHeader
        title="Stock movements"
        description="The stock ledger: every receipt, sale, transfer, count and adjustment, with who did it and the cost at the time."
        actions={can(actor, "data.export") ? <a className="btn btn-ghost" href={`/api/exports/movements?${filters.toString()}`} download>Export CSV</a> : undefined}
      />
      <form className="mb-4 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6" role="search">
        <Field label="Item" htmlFor="q"><input id="q" name="q" type="search" className="field" defaultValue={sp.q} placeholder="SKU or name" /></Field>
        <Field label="Type" htmlFor="reason">
          <select id="reason" name="reason" className="field" defaultValue={sp.reason ?? ""}>
            <option value="">All</option>
            {Object.entries(MOVEMENT_LABELS).filter(([k]) => k !== "adjustment").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Location" htmlFor="location">
          <select id="location" name="location" className="field" defaultValue={sp.location ?? ""}>
            <option value="">All</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        <Field label="From" htmlFor="from"><input id="from" name="from" type="date" className="field" defaultValue={sp.from} /></Field>
        <Field label="To" htmlFor="to"><input id="to" name="to" type="date" className="field" defaultValue={sp.to} /></Field>
        <div className="flex items-end"><button className="btn btn-primary w-full" type="submit">Show</button></div>
      </form>
      <Card>
        {rows.length === 0 ? <EmptyState title="No movements match" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>When</th><th>Item</th><th>Location</th><th className="text-right">Change</th><th>Type</th><th className="text-right">Value</th><th>Note / reference</th><th>By</th></tr></thead>
              <tbody>
                {rows.slice(0, PAGE).map((r) => (
                  <tr key={r.m.id}>
                    <td className="whitespace-nowrap text-xs"><DateTime value={r.m.createdAt} /></td>
                    <td><span className="font-mono text-xs">{r.sku}</span><span className="block text-xs text-slate-600">{r.productName}</span></td>
                    <td className="text-xs">{r.locationName}</td>
                    <td className={`text-right tabular-nums font-semibold ${r.m.quantity < 0 ? "text-red-700" : "text-emerald-700"}`}>{r.m.quantity > 0 ? `+${r.m.quantity}` : r.m.quantity}</td>
                    <td className="text-xs">{MOVEMENT_LABELS[r.m.reason] ?? r.m.reason}</td>
                    <td className="text-right text-xs tabular-nums">{r.m.unitCostMinor === null ? "—" : <Money minor={r.m.unitCostMinor * r.m.quantity} />}</td>
                    <td className="max-w-xs text-xs">
                      {r.m.note}
                      {r.m.refType === "order" && <Link href={`/ops/orders/${r.m.refId}`} className="ml-1 text-teal-700 underline">order</Link>}
                      {r.m.refType === "transfer" && <Link href={`/ops/inventory/transfers/${r.m.refId}`} className="ml-1 text-teal-700 underline">transfer</Link>}
                      {r.m.refType === "stock_count" && <Link href={`/ops/inventory/counts/${r.m.refId}`} className="ml-1 text-teal-700 underline">stocktake</Link>}
                      {r.m.refType === "return" && <Link href={`/ops/returns/${r.m.refId}`} className="ml-1 text-teal-700 underline">return</Link>}
                    </td>
                    <td className="text-xs">{r.actorName ?? "System"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <nav aria-label="Pages" className="mt-4 flex justify-between text-sm">
          {page > 0 ? <Link href={pageLink(page - 1)} className="text-teal-700 underline">← Newer</Link> : <span />}
          {rows.length > PAGE && <Link href={pageLink(page + 1)} className="text-teal-700 underline">Older →</Link>}
        </nav>
      </Card>
    </>
  );
}
