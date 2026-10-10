import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { AppError } from "@/server/lib/errors";
import { listCustomersWithStats } from "@/server/modules/customers";
import { Badge, Card, DateTime, EmptyState, Money, PageHeader, TableWrap } from "@/components/ui";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const actor = await requireActor("operator");
  const rows = await listCustomersWithStats(getDb(), actor).catch((e) => {
    if (e instanceof AppError) return null;
    throw e;
  });
  if (!rows) return <EmptyState title="You can't open this page">Customer history needs sales, order or finance access.</EmptyState>;
  const showOrders = rows.some((r) => r.orders !== null);
  const showOwed = rows.some((r) => r.outstandingMinor !== null);
  return (
    <>
      <PageHeader title="Customers" description="Every customer organisation, with its quotations, orders, invoices, returns and contacts in one place." />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No customers yet">Convert a qualified lead to create one.</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  {showOrders && <th className="text-right">Orders</th>}
                  {showOrders && <th>Last order</th>}
                  {showOwed && <th className="text-right">Outstanding</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.org.id}>
                    <td>
                      <Link href={`/ops/customers/${r.org.id}`} className="font-medium text-teal-700 hover:underline">{r.org.name}</Link>
                      {r.org.isDemo && <span className="ml-2"><Badge tone="amber">Demonstration</Badge></span>}
                    </td>
                    {showOrders && <td className="text-right">{r.orders}</td>}
                    {showOrders && <td><DateTime value={r.lastOrderAt} dateOnly /></td>}
                    {showOwed && <td className="text-right">{r.outstandingMinor ? <Money minor={r.outstandingMinor} /> : "—"}</td>}
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
