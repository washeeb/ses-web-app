import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { listQuotes } from "@/server/modules/sales";
import { can } from "@/server/authz/policy";
import { Card, DateTime, EmptyState, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export default async function QuotesPage() {
  const actor = await requireActor("operator");
  const rows = await listQuotes(getDb(), actor);
  return (
    <>
      <PageHeader
        title="Quotations"
        description="Draft → approval (when over limits) → sent → accepted by the customer → order."
        actions={
          <>
            <LiveRefresh topics={["quotes", "approvals"]} />
            {can(actor, "quotes.write") && <Link href="/ops/quotes/new" className="btn btn-primary">New quotation</Link>}
          </>
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No quotations yet" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Number</th><th>Customer</th><th>Status</th><th className="text-right">Total</th><th>Valid until</th><th>Created</th></tr>
              </thead>
              <tbody>
                {rows.map(({ quote: q, customerName }) => (
                  <tr key={q.id}>
                    <td><Link className="font-medium text-teal-700 hover:underline" href={`/ops/quotes/${q.id}`}>{q.number}</Link></td>
                    <td>{customerName}</td>
                    <td><StatusBadge status={q.status} /></td>
                    <td className="text-right"><Money minor={q.totalMinor} currency={q.currency} /></td>
                    <td><DateTime value={q.validUntil} dateOnly /></td>
                    <td><DateTime value={q.createdAt} /></td>
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
