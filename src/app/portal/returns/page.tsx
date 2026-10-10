import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { listReturns, listWarranties } from "@/server/modules/returns";
import { getSettings } from "@/server/modules/settings";
import { KIND_LABEL, RESOLUTION_LABEL } from "@/components/return-view";
import { Card, DateTime, EmptyState, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export default async function PortalReturnsPage() {
  const actor = await requireActor("customer");
  const db = getDb();
  const [rows, cover, s] = await Promise.all([listReturns(db, actor), listWarranties(db, actor), getSettings(db)]);
  const now = new Date();
  return (
    <>
      <PageHeader
        title="Returns & warranty"
        description={`You can return items within ${s.returnWindowDays} days of delivery. Faulty items under warranty can be claimed until the date shown. Start a request from the delivered order.`}
        actions={<LiveRefresh topics={["returns"]} />}
      />
      <Card title="Your requests">
        {rows.length === 0 ? (
          <EmptyState title="No requests yet">Open a delivered order and choose “Return or claim warranty”.</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Number</th><th>Order</th><th>Type</th><th>Status</th><th>Requested</th></tr></thead>
              <tbody>
                {rows.map(({ r, orderNumber }) => (
                  <tr key={r.id}>
                    <td><Link href={`/portal/returns/${r.id}`} className="font-medium text-teal-700 hover:underline">{r.number}</Link></td>
                    <td>{orderNumber}</td>
                    <td>{KIND_LABEL[r.kind]} · {RESOLUTION_LABEL[r.resolution]}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td><DateTime value={r.createdAt} dateOnly /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <Card title="Warranty cover" className="mt-6">
        {cover.length === 0 ? (
          <EmptyState title="No warranties">Products with a warranty are listed here once delivered.</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Item</th><th>Order</th><th className="text-right">Qty</th><th>Covered until</th></tr></thead>
              <tbody>
                {cover.map(({ w, description, orderNumber }) => (
                  <tr key={w.id}>
                    <td>{description}</td>
                    <td><Link href={`/portal/orders/${w.orderId}`} className="text-teal-700 hover:underline">{orderNumber}</Link></td>
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
