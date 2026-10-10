import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { listReturns, listWarranties } from "@/server/modules/returns";
import { KIND_LABEL, RESOLUTION_LABEL } from "@/components/return-view";
import { Card, DateTime, EmptyState, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export default async function ReturnsPage() {
  const actor = await requireActor("operator");
  const db = getDb();
  const [rows, cover] = await Promise.all([listReturns(db, actor), listWarranties(db, actor)]);
  const now = new Date();
  return (
    <>
      <PageHeader
        title="Returns & warranty"
        description="Customer returns (within the return window) and warranty claims: approve → receive (optionally restock) → refund approval or replacement/repair."
        actions={<LiveRefresh topics={["returns", "approvals"]} />}
      />
      <Card title="Requests">
        {rows.length === 0 ? (
          <EmptyState title="No returns or claims" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Number</th><th>Customer</th><th>Order</th><th>Type</th><th>Status</th><th>Requested</th></tr></thead>
              <tbody>
                {rows.map(({ r, orderNumber, customerName }) => (
                  <tr key={r.id}>
                    <td><Link href={`/ops/returns/${r.id}`} className="font-medium text-teal-700 hover:underline">{r.number}</Link></td>
                    <td>{customerName}</td>
                    <td>{orderNumber}</td>
                    <td>{KIND_LABEL[r.kind]} · {RESOLUTION_LABEL[r.resolution]}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td><DateTime value={r.createdAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <Card title="Warranties" className="mt-6">
        {cover.length === 0 ? (
          <EmptyState title="No warranties yet">Warranties start when an order containing products with a warranty period is fulfilled.</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Customer</th><th>Item</th><th>Order</th><th className="text-right">Qty</th><th>Covered until</th></tr></thead>
              <tbody>
                {cover.map(({ w, description, orderNumber, customerName }) => (
                  <tr key={w.id}>
                    <td>{customerName}</td>
                    <td>{description}</td>
                    <td>{orderNumber}</td>
                    <td className="text-right">{w.quantity}</td>
                    <td><DateTime value={w.endsAt} dateOnly />{w.endsAt < now && <span className="ml-1 text-xs text-slate-500">(expired)</span>}</td>
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
