import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { balanceOf, isOverdue, listInvoices, receivables, type InvoiceFilter } from "@/server/modules/invoices";
import { Badge, Card, DateTime, EmptyState, Money, PageHeader, Stat, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Invoices" };

const FILTERS: { key: InvoiceFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "void", label: "Void" },
  { key: "all", label: "All" },
];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor("operator");
  const sp = await searchParams;
  const filter = (FILTERS.find((f) => f.key === sp.show)?.key ?? "open") as InvoiceFilter;
  const db = getDb();
  if (!can(actor, "finance.read") && !can(actor, "orders.read")) {
    return <EmptyState title="You can't open this page">Invoices need finance or order access.</EmptyState>;
  }
  const [rows, totals] = await Promise.all([listInvoices(db, actor, { filter }), receivables(db, actor)]);
  const now = new Date();
  return (
    <>
      <PageHeader title="Invoices" description="Issued automatically for every order. Record bank, mobile money, cash and cheque payments here; online payments apply themselves once Paystack confirms them." actions={<LiveRefresh topics={["invoices"]} />} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Receivables" value={<Money minor={totals.outstandingMinor} />} href="/ops/invoices?show=open" />
        <Stat label="Overdue" value={<Money minor={totals.overdueMinor} />} href="/ops/invoices?show=overdue" tone={totals.overdueMinor > 0 ? "red" : undefined} />
        <Stat label="Open invoices" value={totals.openCount} href="/ops/invoices?show=open" />
      </div>
      <nav aria-label="Invoice filters" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/ops/invoices?show=${f.key}`} aria-current={f.key === filter ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm font-medium ${f.key === filter ? "bg-brand-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}>
            {f.label}
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No invoices here" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Due</th><th className="text-right">Total</th><th className="text-right">Balance</th></tr>
              </thead>
              <tbody>
                {rows.map(({ invoice: inv, customerName, orderNumber }) => (
                  <tr key={inv.id}>
                    <td>
                      <Link href={`/ops/invoices/${inv.id}`} className="font-medium text-teal-700 hover:underline">{inv.number}</Link>
                      {orderNumber && <span className="block text-xs text-slate-500">Order {orderNumber}</span>}
                    </td>
                    <td><Link href={`/ops/customers/${inv.customerOrgId}`} className="hover:underline">{customerName}</Link></td>
                    <td className="space-x-1"><StatusBadge status={inv.status} />{isOverdue(inv, now) && <Badge tone="red">overdue</Badge>}</td>
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
