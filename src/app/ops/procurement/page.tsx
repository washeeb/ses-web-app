import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listPurchaseOrders } from "@/server/modules/procurement";
import { Card, DateTime, EmptyState, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export default async function ProcurementPage() {
  const actor = await requireActor("operator");
  const rows = await listPurchaseOrders(getDb(), actor);
  return (
    <>
      <PageHeader
        title="Procurement"
        description="Purchase orders to suppliers: draft → approval above the limit → sent → goods received into stock."
        actions={
          <>
            <LiveRefresh topics={["approvals", "stock"]} />
            <Link href="/ops/procurement/suppliers" className="btn btn-ghost">Suppliers</Link>
            {can(actor, "procurement.write") && <Link href="/ops/procurement/new" className="btn btn-primary">New purchase order</Link>}
          </>
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No purchase orders yet">Add your suppliers first, then raise a purchase order.</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Number</th><th>Supplier</th><th>Status</th><th className="text-right">Total</th><th>Expected</th><th>Created</th></tr></thead>
              <tbody>
                {rows.map(({ po, supplierName }) => (
                  <tr key={po.id}>
                    <td><Link href={`/ops/procurement/${po.id}`} className="font-medium text-teal-700 hover:underline">{po.number}</Link></td>
                    <td>{supplierName}</td>
                    <td><StatusBadge status={po.status} /></td>
                    <td className="text-right"><Money minor={po.totalMinor} currency={po.currency} /></td>
                    <td><DateTime value={po.expectedAt} dateOnly /></td>
                    <td><DateTime value={po.createdAt} /></td>
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
