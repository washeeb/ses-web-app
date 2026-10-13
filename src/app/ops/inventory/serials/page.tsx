import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { searchSerials } from "@/server/modules/inventory";
import { Card, DateTime, EmptyState, PageHeader, StatusBadge, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "Serial numbers" };

export default async function SerialsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "inventory.read")) return <EmptyState title="You can't open this page" />;
  const { q = "" } = await searchParams;
  const rows = q ? await searchSerials(getDb(), actor, q) : [];
  return (
    <>
      <PageHeader title="Serial numbers" description="Find a unit by its serial number: where it is, or who bought it and when — for warranty claims and returns." />
      <form role="search" className="mb-4 flex max-w-lg gap-2">
        <label htmlFor="q" className="sr-only">Serial number</label>
        <input id="q" name="q" type="search" className="field font-mono uppercase" defaultValue={q} placeholder="Serial number (or part of it)" autoFocus />
        <button className="btn btn-primary" type="submit">Find</button>
      </form>
      <Card>
        {!q ? <p className="text-sm text-slate-600">Enter at least two characters.</p> : rows.length === 0 ? <EmptyState title="No serial numbers match" /> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Serial</th><th>Item</th><th>Status</th><th>Where / sold to</th><th>Received</th><th>Sold</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.s.id}>
                    <td className="font-mono">{r.s.serial}</td>
                    <td><span className="font-mono text-xs">{r.sku}</span><span className="block text-xs text-slate-600">{r.productName}</span></td>
                    <td><StatusBadge status={r.s.status} /></td>
                    <td className="text-sm">{r.s.status === "sold" && r.orderNumber ? <Link href={`/ops/orders/${r.s.orderId}`} className="text-teal-700 underline">{r.orderNumber}</Link> : r.locationName ?? "—"}{r.customer && <span className="block text-xs text-slate-600">{r.customer}</span>}{r.s.note && <span className="block text-xs text-slate-600">{r.s.note}</span>}</td>
                    <td className="text-xs"><DateTime value={r.s.receivedAt} dateOnly /></td>
                    <td className="text-xs">{r.s.soldAt ? <DateTime value={r.s.soldAt} dateOnly /> : "—"}</td>
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
