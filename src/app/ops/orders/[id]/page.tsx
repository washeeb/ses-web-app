import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { getOrder } from "@/server/modules/sales";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, DateTime, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { orderAction } from "../../actions";
import { listPayments } from "@/server/modules/payments/paystack";
import { DocumentsPanel } from "@/components/documents-panel";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const o = await getOrder(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const canWrite = can(actor, "orders.write");
  const holds = o.reservations.filter((r) => r.status === "active");
  const payments = await listPayments(getDb(), o.id);
  return (
    <>
      <PageHeader
        title={`Order ${o.number}`}
        description={<>Customer: {o.customerName} · created <DateTime value={o.createdAt} /></>}
        actions={
          <>
            <LiveRefresh topics={["orders"]} />
            <StatusBadge status={o.status} />
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title="Lines">
          <TableWrap>
            <table className="table">
              <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Amount</th><th>Fulfilment</th></tr></thead>
              <tbody>
                {o.lines.map(({ line: l, connectionName }) => (
                  <tr key={l.id}>
                    <td>{l.description}</td>
                    <td className="text-right">{l.quantity}</td>
                    <td className="text-right"><Money minor={l.lineTotalMinor} currency={o.currency} /></td>
                    <td>
                      {connectionName ? (
                        <>
                          <StatusBadge status={l.fulfilmentStatus} />
                          <p className="text-xs text-slate-500">by {connectionName}</p>
                        </>
                      ) : (
                        <span className="text-xs text-slate-500">SES</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd><Money minor={o.subtotalMinor} /></dd></div>
            <div className="flex justify-between"><dt>Discount</dt><dd>−<Money minor={o.discountMinor} /></dd></div>
            <div className="flex justify-between"><dt>Taxes</dt><dd><Money minor={o.taxMinor} /></dd></div>
            <div className="flex justify-between font-bold"><dt>Total</dt><dd><Money minor={o.totalMinor} /></dd></div>
          </dl>
          {o.quoteId && <p className="mt-4 text-sm"><Link href={`/ops/quotes/${o.quoteId}`} className="text-teal-700 hover:underline">View source quotation</Link></p>}
        </Card>
        <div className="min-w-0 space-y-6">
          <Card title="Payment" actions={o.paymentStatus === "paid" ? <Badge tone="green">paid</Badge> : <Badge tone="amber">unpaid</Badge>}>
            <p className="text-sm">{o.paymentStatus === "paid" ? <>Paid <DateTime value={o.paidAt} /></> : "No successful payment yet."}</p>
            {payments.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs">
                {payments.map((p) => (
                  <li key={p.id}>
                    <span className="font-mono">{p.reference}</span> · {p.status.replace("_", " ")}{p.channel && ` · ${p.channel}`} · {p.mode}
                    {p.failureReason && <span className="block text-slate-500">{p.failureReason}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <DocumentsPanel actor={actor} entityType="order" entityId={o.id} path={`/ops/orders/${o.id}`} customerFacing />
          <Card title="Stock reservations">
            {holds.length === 0 ? (
              <p className="text-sm text-slate-500">No active holds.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {holds.map((r) => (
                  <li key={r.id}>{r.quantity} unit(s){r.expiresAt ? <> · expires <DateTime value={r.expiresAt} /></> : " · held until fulfilment"}</li>
                ))}
              </ul>
            )}
          </Card>
          {canWrite && ["pending", "confirmed"].includes(o.status) && (
            <Card title="Actions">
              <div className="space-y-3">
                {o.status === "pending" && (
                  <ActionForm action={orderAction} submitLabel="Confirm order" submitClassName="btn btn-primary w-full">
                    <input type="hidden" name="id" value={o.id} />
                    <input type="hidden" name="op" value="confirm" />
                  </ActionForm>
                )}
                {o.status === "confirmed" && (
                  <ActionForm action={orderAction} submitLabel="Mark fulfilled" submitClassName="btn btn-accent w-full">
                    <input type="hidden" name="id" value={o.id} />
                    <input type="hidden" name="op" value="fulfil" />
                  </ActionForm>
                )}
                <ActionForm action={orderAction} submitLabel="Cancel order" submitClassName="btn btn-danger w-full" confirm="Cancel this order and release its stock?">
                  <input type="hidden" name="id" value={o.id} />
                  <input type="hidden" name="op" value="cancel" />
                  <label className="field-label" htmlFor="reason">Cancellation reason</label>
                  <input id="reason" name="reason" className="field" required minLength={3} />
                </ActionForm>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
