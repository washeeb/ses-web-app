import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { getOrder } from "@/server/modules/sales";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { listPayments, paystackConfig, verifyAndApplyPayment } from "@/server/modules/payments/paystack";
import { log } from "@/server/lib/log";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, DateTime, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { payOrderAction } from "../../actions";
import { DocumentsPanel } from "@/components/documents-panel";

export default async function PortalOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ payment?: string }> }) {
  const { id } = await params;
  const { payment: returnedRef } = await searchParams;
  const actor = await requireActor("customer");
  const db = getDb();
  let o = await getOrder(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  let payments = await listPayments(db, o.id);

  // Returning from Paystack: confirm with Paystack's API (the redirect itself proves nothing).
  let returnNote: string | null = null;
  if (returnedRef && paystackConfig() && payments.some((p) => p.reference === returnedRef)) {
    try {
      const r = await verifyAndApplyPayment(db, returnedRef);
      returnNote = r === "applied" || r === "already_applied" ? "Payment received — thank you." : r === "not_successful" ? "We have not received a successful payment yet. Mobile money approvals can take a minute; this page updates automatically." : r === "amount_mismatch" ? "The amount paid does not match this order. Our finance team will contact you." : null;
    } catch (err) {
      log.warn("paystack.return_verify_failed", { error: err instanceof Error ? err.message : String(err) });
      returnNote = "We could not confirm the payment yet. It will update automatically once Paystack confirms it.";
    }
    o = await getOrder(db, actor, id);
    payments = await listPayments(db, o.id);
  }

  const cfg = paystackConfig();
  const canPay = !!cfg && o.paymentStatus !== "paid" && ["pending", "confirmed"].includes(o.status) && can(actor, "customer.orders.pay", { organizationId: o.customerOrgId });
  return (
    <>
      <Link href="/portal" className="text-sm text-teal-700 hover:underline">← Back to your account</Link>
      <div className="mt-4">
        <PageHeader
          title={`Order ${o.number}`}
          description={<>Placed <DateTime value={o.createdAt} /></>}
          actions={<><LiveRefresh topics={["orders"]} /><StatusBadge status={o.status} />{o.paymentStatus === "paid" ? <Badge tone="green">paid</Badge> : <Badge tone="amber">unpaid</Badge>}</>}
        />
      </div>
      {returnNote && <p role="status" className="mb-4 rounded-lg bg-slate-100 px-4 py-2 text-sm">{returnNote}</p>}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <TableWrap>
            <table className="table">
              <thead><tr><th>Item</th><th className="text-right">Qty</th><th className="text-right">Amount</th><th>Delivery status</th></tr></thead>
              <tbody>
                {o.lines.map(({ line: l }) => (
                  <tr key={l.id}>
                    <td>{l.description}</td>
                    <td className="text-right">{l.quantity}</td>
                    <td className="text-right"><Money minor={l.lineTotalMinor} currency={o.currency} /></td>
                    <td>{l.fulfilmentConnectionId ? <StatusBadge status={l.fulfilmentStatus} /> : <StatusBadge status={o.status} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="mt-4 text-right font-bold">Total <Money minor={o.totalMinor} currency={o.currency} /></p>
        </Card>
        <div className="min-w-0 space-y-6">
        <Card title="Payment">
          {o.paymentStatus === "paid" ? (
            <p className="text-sm">Paid <DateTime value={o.paidAt} />.</p>
          ) : canPay ? (
            <ActionForm action={payOrderAction} submitLabel={<>Pay <Money minor={o.totalMinor} currency={o.currency} /></>} submitClassName="btn btn-accent w-full">
              <input type="hidden" name="id" value={o.id} />
              <p className="text-sm text-slate-600">Card or mobile money via Paystack. You will return here afterwards.</p>
              {cfg?.mode === "test" && <p className="text-xs font-semibold text-amber-700">Test mode — no real money is charged.</p>}
            </ActionForm>
          ) : (
            <p className="text-sm text-slate-600">{cfg ? "Online payment is not available for this order." : "Online payment is not available yet. Our team will send payment instructions."}</p>
          )}
          {payments.length > 0 && (
            <ul className="mt-4 space-y-1 text-xs text-slate-500">
              {payments.map((p) => (
                <li key={p.id}>{p.reference} · <StatusBadge status={p.status} /> {p.mode === "test" && "(test)"}</li>
              ))}
            </ul>
          )}
        </Card>
        <DocumentsPanel actor={actor} entityType="order" entityId={o.id} path={`/portal/orders/${o.id}`} />
        </div>
      </div>
    </>
  );
}
