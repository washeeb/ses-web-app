import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { AppError } from "@/server/lib/errors";
import { customerHistory } from "@/server/modules/customers";
import { balanceOf, isOverdue } from "@/server/modules/invoices";
import { Badge, Card, DateTime, EmptyState, Money, PageHeader, Stat, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Customer history" };

export default async function CustomerHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const h = await customerHistory(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const now = new Date();
  return (
    <>
      <Link href="/ops/customers" className="text-sm text-teal-700 hover:underline">← Customers</Link>
      <div className="mt-4">
        <PageHeader
          title={h.org.name}
          description={<>Customer since <DateTime value={h.org.createdAt} dateOnly />{h.org.website && <> · {h.org.website}</>}</>}
          actions={
            <>
              <LiveRefresh topics={["orders", "invoices", "quotes", "returns"]} />
              {h.org.isDemo && <Badge tone="amber">Demonstration</Badge>}
            </>
          }
        />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {h.lifetimeMinor !== null && <Stat label="Ordered (all time)" value={<Money minor={h.lifetimeMinor} />} />}
        {h.receivables && <Stat label="Outstanding" value={<Money minor={h.receivables.outstandingMinor} />} />}
        {h.receivables && <Stat label="Overdue" value={<Money minor={h.receivables.overdueMinor} />} tone={h.receivables.overdueMinor > 0 ? "red" : undefined} />}
        {h.orders && <Stat label="Orders" value={h.orders.length} />}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {h.invoices && (
          <Card title="Invoices">
            {h.invoices.length === 0 ? (
              <EmptyState title="No invoices" />
            ) : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Invoice</th><th>Status</th><th>Due</th><th className="text-right">Balance</th></tr></thead>
                  <tbody>
                    {h.invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td><Link href={`/ops/invoices/${inv.id}`} className="font-medium text-teal-700 hover:underline">{inv.number}</Link></td>
                        <td className="space-x-1"><StatusBadge status={inv.status} />{isOverdue(inv, now) && <Badge tone="red">overdue</Badge>}</td>
                        <td><DateTime value={inv.dueAt} dateOnly /></td>
                        <td className="text-right"><Money minor={inv.status === "void" ? 0 : balanceOf(inv)} currency={inv.currency} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        )}

        {h.orders && (
          <Card title="Orders">
            {h.orders.length === 0 ? (
              <EmptyState title="No orders" />
            ) : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Order</th><th>Status</th><th>Payment</th><th className="text-right">Total</th></tr></thead>
                  <tbody>
                    {h.orders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <Link href={`/ops/orders/${o.id}`} className="font-medium text-teal-700 hover:underline">{o.number}</Link>
                          <span className="block text-xs text-slate-500">{o.source === "store" ? "Online store" : "Quotation"} · <DateTime value={o.createdAt} dateOnly /></span>
                        </td>
                        <td><StatusBadge status={o.status} /></td>
                        <td><StatusBadge status={o.paymentStatus} /></td>
                        <td className="text-right"><Money minor={o.totalMinor} currency={o.currency} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        )}

        {h.quotes && (
          <Card title="Quotations">
            {h.quotes.length === 0 ? (
              <EmptyState title="No quotations" />
            ) : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Quotation</th><th>Status</th><th className="text-right">Total</th></tr></thead>
                  <tbody>
                    {h.quotes.map((q) => (
                      <tr key={q.id}>
                        <td>
                          <Link href={`/ops/quotes/${q.id}`} className="font-medium text-teal-700 hover:underline">{q.number}</Link>
                          <span className="block text-xs text-slate-500"><DateTime value={q.createdAt} dateOnly /></span>
                        </td>
                        <td><StatusBadge status={q.status} /></td>
                        <td className="text-right"><Money minor={q.totalMinor} currency={q.currency} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        )}

        {h.returns && (
          <Card title="Returns & warranty claims">
            {h.returns.length === 0 ? (
              <EmptyState title="No returns" />
            ) : (
              <ul className="space-y-2 text-sm">
                {h.returns.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/ops/returns/${r.id}`} className="font-medium text-teal-700 hover:underline">{r.number}</Link>
                    <StatusBadge status={r.status} />
                    <span className="text-slate-600">{r.kind === "warranty" ? "Warranty claim" : "Return"} · <DateTime value={r.createdAt} dateOnly /></span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card title="Contacts">
          {h.contacts.length === 0 ? (
            <EmptyState title="No portal users yet" />
          ) : (
            <ul className="space-y-2 text-sm">
              {h.contacts.map((c) => (
                <li key={c.id}>
                  <span className="font-medium">{c.name}</span> · {c.email} {c.status !== "active" && <StatusBadge status={c.status} />}
                  <span className="block text-xs text-slate-500">Last sign-in: <DateTime value={c.lastLoginAt} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {h.leads && h.leads.length > 0 && (
          <Card title="Source leads">
            <ul className="space-y-2 text-sm">
              {h.leads.map((l) => (
                <li key={l.id}>
                  <span className="font-medium">{l.number}</span> · {l.contactName} · <StatusBadge status={l.status} />
                  {l.serviceInterest && <span className="block text-xs text-slate-500">{l.serviceInterest}</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
