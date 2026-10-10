import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { balanceOf, isOverdue, listInvoices, receivables } from "@/server/modules/invoices";
import { Badge, Card, DateTime, EmptyState, Money, PageHeader, Stat, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Invoices" };

export default async function PortalInvoices() {
  const actor = await requireActor("customer");
  const db = getDb();
  const [rows, totals] = await Promise.all([listInvoices(db, actor), receivables(db, actor)]);
  const now = new Date();
  return (
    <>
      <PageHeader title="Invoices" description="Every invoice SES has issued to your organisation, with what has been paid." actions={<LiveRefresh topics={["invoices"]} />} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Outstanding" value={<Money minor={totals.outstandingMinor} />} />
        <Stat label="Overdue" value={<Money minor={totals.overdueMinor} />} tone={totals.overdueMinor > 0 ? "red" : undefined} />
        <Stat label="Open invoices" value={totals.openCount} />
      </div>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No invoices yet">Invoices appear here when you place an order or accept a quotation.</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Invoice</th><th>Status</th><th>Issued</th><th>Due</th><th className="text-right">Total</th><th className="text-right">Balance</th></tr>
              </thead>
              <tbody>
                {rows.map(({ invoice: inv, orderNumber }) => (
                  <tr key={inv.id}>
                    <td>
                      <Link href={`/portal/invoices/${inv.id}`} className="font-medium text-teal-700 hover:underline">{inv.number}</Link>
                      {orderNumber && <span className="block text-xs text-slate-500">Order {orderNumber}</span>}
                    </td>
                    <td className="space-x-1"><StatusBadge status={inv.status} />{isOverdue(inv, now) && <Badge tone="red">overdue</Badge>}</td>
                    <td><DateTime value={inv.issuedAt} dateOnly /></td>
                    <td><DateTime value={inv.dueAt} dateOnly /></td>
                    <td className="text-right"><Money minor={inv.totalMinor} currency={inv.currency} /></td>
                    <td className="text-right"><Money minor={inv.status === "void" ? 0 : balanceOf(inv)} currency={inv.currency} /></td>
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
