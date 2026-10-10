import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { listOrders, listQuotes } from "@/server/modules/sales";
import { can } from "@/server/authz/policy";
import { Card, DateTime, EmptyState, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export default async function PortalHome() {
  const actor = await requireActor("customer");
  const db = getDb();
  const [quotes, orders] = await Promise.all([
    can(actor, "customer.quotes.read", { organizationId: actor.organizationId }) ? listQuotes(db, actor) : Promise.resolve([]),
    can(actor, "customer.orders.read", { organizationId: actor.organizationId }) ? listOrders(db, actor) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title="Your account" description="Quotations from SES and the orders they became. Invoices, subscriptions, projects, tickets and documents arrive in later releases." actions={<LiveRefresh topics={["quotes", "orders"]} />} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Quotations">
          {quotes.length === 0 ? (
            <EmptyState title="No quotations yet">When SES sends you a quotation it appears here.</EmptyState>
          ) : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Number</th><th>Status</th><th className="text-right">Total</th><th>Valid until</th></tr></thead>
                <tbody>
                  {quotes.map(({ quote: q }) => (
                    <tr key={q.id}>
                      <td><Link href={`/portal/quotes/${q.id}`} className="font-medium text-teal-700 hover:underline">{q.number}</Link></td>
                      <td><StatusBadge status={q.status} /></td>
                      <td className="text-right"><Money minor={q.totalMinor} currency={q.currency} /></td>
                      <td><DateTime value={q.validUntil} dateOnly /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        <Card title="Orders">
          {orders.length === 0 ? (
            <EmptyState title="No orders yet" />
          ) : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Order</th><th>Status</th><th className="text-right">Total</th><th>Placed</th></tr></thead>
                <tbody>
                  {orders.map(({ order: o }) => (
                    <tr key={o.id}>
                      <td><Link href={`/portal/orders/${o.id}`} className="font-medium text-teal-700 hover:underline">{o.number}</Link></td>
                      <td><StatusBadge status={o.status} /></td>
                      <td className="text-right"><Money minor={o.totalMinor} currency={o.currency} /></td>
                      <td><DateTime value={o.createdAt} dateOnly /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
