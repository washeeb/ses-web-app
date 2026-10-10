import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { listOrders } from "@/server/modules/sales";
import { Card, DateTime, EmptyState, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export default async function OrdersPage() {
  const actor = await requireActor("operator");
  const rows = await listOrders(getDb(), actor);
  return (
    <>
      <PageHeader title="Orders" description="Accepted quotations become orders with reserved stock. Confirm to request partner fulfilment; fulfil to consume stock." actions={<LiveRefresh topics={["orders"]} />} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No orders yet">Orders appear when a customer accepts a quotation.</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th className="text-right">Total</th><th>Created</th></tr></thead>
              <tbody>
                {rows.map(({ order: o, customerName }) => (
                  <tr key={o.id}>
                    <td><Link href={`/ops/orders/${o.id}`} className="font-medium text-teal-700 hover:underline">{o.number}</Link></td>
                    <td>{customerName}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td className="text-right"><Money minor={o.totalMinor} currency={o.currency} /></td>
                    <td><DateTime value={o.createdAt} /></td>
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
