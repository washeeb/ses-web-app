import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { log } from "@/server/lib/log";
import { getInvoice, OPEN_STATUSES, PAYMENT_METHOD_LABEL } from "@/server/modules/invoices";
import { paystackConfig, verifyAndApplyPayment } from "@/server/modules/payments/paystack";
import { getSettings, paymentMethods } from "@/server/modules/settings";
import { ActionForm } from "@/components/action-form";
import { InvoiceDocument } from "@/components/invoice-document";
import { PrintButton } from "@/components/print-button";
import { Card, DateTime, Money, StatusBadge } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { payInvoiceAction } from "../../actions";

export const metadata: Metadata = { title: "Invoice" };

export default async function PortalInvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ payment?: string }> }) {
  const { id } = await params;
  const { payment: returnedRef } = await searchParams;
  const actor = await requireActor("customer");
  const db = getDb();
  const load = () =>
    getInvoice(db, actor, id).catch((e) => {
      if (e instanceof AppError) notFound();
      throw e;
    });
  let inv = await load();

  // Returning from Paystack: confirm with Paystack's API (the redirect itself proves nothing).
  let returnNote: string | null = null;
  if (returnedRef && paystackConfig() && inv.payments.some(({ p }) => p.reference === returnedRef)) {
    try {
      const r = await verifyAndApplyPayment(db, returnedRef);
      returnNote = r === "applied" || r === "already_applied" ? "Payment received — thank you." : r === "not_successful" ? "We have not received a successful payment yet. Mobile money approvals can take a minute; this page updates automatically." : r === "amount_mismatch" ? "The amount paid does not match this invoice. Our finance team will contact you." : null;
    } catch (err) {
      log.warn("paystack.return_verify_failed", { error: err instanceof Error ? err.message : String(err) });
      returnNote = "We could not confirm the payment yet. It will update automatically once Paystack confirms it.";
    }
    inv = await load();
  }

  const [settings, cfg] = [await getSettings(db), paystackConfig()];
  const canPay = !!cfg && OPEN_STATUSES.includes(inv.status) && can(actor, "customer.orders.pay", { organizationId: inv.customerOrgId });
  const received = inv.payments.filter(({ p }) => p.status === "success" || p.status === "reversed");
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/portal/invoices" className="text-sm text-teal-700 hover:underline">← All invoices</Link>
        <div className="flex items-center gap-3"><LiveRefresh topics={["invoices"]} /><PrintButton /></div>
      </div>
      <h1 className="sr-only">Invoice {inv.number}</h1>
      {returnNote && <p role="status" className="mt-4 rounded-lg bg-slate-100 px-4 py-2 text-sm">{returnNote}</p>}
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_300px] print:block">
        <InvoiceDocument inv={inv} settings={settings} orderHref={inv.orderId ? `/portal/orders/${inv.orderId}` : null} now={new Date()} />
        <div className="min-w-0 space-y-6 print:hidden">
          {OPEN_STATUSES.includes(inv.status) && (
            <Card title="Pay online">
              {canPay ? (
                <ActionForm action={payInvoiceAction} submitLabel={<>Pay <Money minor={inv.totalMinor - inv.paidMinor} currency={inv.currency} /></>} submitClassName="btn btn-accent w-full">
                  <input type="hidden" name="id" value={inv.id} />
                  <p className="text-sm text-slate-600">Card or mobile money via Paystack. You will return here afterwards.</p>
                  {cfg?.mode === "test" && <p className="text-xs font-semibold text-amber-700">Test mode — no real money is charged.</p>}
                </ActionForm>
              ) : (
                <p className="text-sm text-slate-600">{cfg ? "Your account cannot pay online. Ask your organisation's administrator." : paymentMethods(settings).length > 0 || settings.paymentInstructions ? "Online payment is not available yet. Use the payment details on the invoice." : `Online payment is not available yet. Contact ${settings.supportEmail} for payment details.`}</p>
              )}
            </Card>
          )}
          <Card title="Payments">
            {received.length === 0 ? (
              <p className="text-sm text-slate-500">No payments yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {received.map(({ p }) => (
                  <li key={p.id}>
                    <Money minor={p.amountMinor} currency={p.currency} /> · {PAYMENT_METHOD_LABEL[p.method ?? ""] ?? p.method ?? p.provider} · <DateTime value={p.paidAt} dateOnly />
                    {p.status === "reversed" && <> · <StatusBadge status="reversed" /></>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
