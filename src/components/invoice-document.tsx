import Link from "next/link";
import type { getInvoice } from "@/server/modules/invoices";
import { balanceOf, isOverdue } from "@/server/modules/invoices";
import { paymentMethods, type CompanySettings } from "@/server/modules/settings";
import { Badge, DateTime, Money, StatusBadge } from "./ui";

type InvoiceView = Awaited<ReturnType<typeof getInvoice>>;

/** The invoice itself, shared by staff and customer pages and laid out to print cleanly. */
export function InvoiceDocument({ inv, settings, orderHref, now }: { inv: InvoiceView; settings: CompanySettings; orderHref: string | null; now: Date }) {
  const overdue = isOverdue(inv, now);
  const balance = balanceOf(inv);
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none" aria-labelledby="invoice-title">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-lg font-bold text-slate-900">{settings.companyName}</p>
          {settings.companyAddress && <p className="text-sm text-slate-600">{settings.companyAddress}</p>}
          <p className="text-sm text-slate-600">{settings.supportEmail} · {settings.supportPhone}</p>
          {settings.companyTin && <p className="text-sm text-slate-600">TIN {settings.companyTin}</p>}
        </div>
        <div className="text-right">
          <h2 id="invoice-title" className="text-2xl font-bold text-slate-900">Invoice {inv.number}</h2>
          <div className="mt-1 flex flex-wrap justify-end gap-1.5">
            <StatusBadge status={inv.status} />
            {overdue && <Badge tone="red">overdue</Badge>}
            {inv.isDemo && <Badge tone="amber">Demonstration</Badge>}
          </div>
        </div>
      </div>

      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="font-semibold text-slate-700">Bill to</dt>
          <dd>{inv.customerName}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-700">Issued</dt>
          <dd><DateTime value={inv.issuedAt} dateOnly /></dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-700">Due</dt>
          <dd className={overdue ? "font-semibold text-red-700" : ""}><DateTime value={inv.dueAt} dateOnly /></dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-700">References</dt>
          <dd>
            {inv.orderNumber ? (orderHref ? <Link href={orderHref} className="text-teal-700">Order {inv.orderNumber}</Link> : <>Order {inv.orderNumber}</>) : "—"}
            {inv.customerReference && <span className="block">Your ref. {inv.customerReference}</span>}
          </dd>
        </div>
      </dl>

      <div className="mt-6 overflow-x-auto">
        <table className="table">
          <caption className="sr-only">Invoice lines</caption>
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col" className="text-right">Qty</th>
              <th scope="col" className="text-right">Unit price</th>
              <th scope="col" className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {inv.lines.map((l) => (
              <tr key={l.id}>
                <td>
                  {l.description}
                  {!l.taxable && <span className="ml-1 text-xs text-slate-500">(tax exempt)</span>}
                </td>
                <td className="text-right">{l.quantity}</td>
                <td className="text-right"><Money minor={l.unitPriceMinor} currency={inv.currency} /></td>
                <td className="text-right"><Money minor={l.lineTotalMinor} currency={inv.currency} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd><Money minor={inv.subtotalMinor} currency={inv.currency} /></dd></div>
        {inv.discountMinor > 0 && <div className="flex justify-between"><dt>Discount</dt><dd>−<Money minor={inv.discountMinor} currency={inv.currency} /></dd></div>}
        {inv.taxBreakdown.length > 0 ? (
          inv.taxBreakdown.map((t) => (
            <div key={t.code} className="flex justify-between"><dt>{t.name}</dt><dd><Money minor={t.amountMinor} currency={inv.currency} /></dd></div>
          ))
        ) : (
          <div className="flex justify-between"><dt>Taxes</dt><dd><Money minor={inv.taxMinor} currency={inv.currency} /></dd></div>
        )}
        <div className="flex justify-between border-t border-slate-200 pt-1 font-bold"><dt>Total</dt><dd><Money minor={inv.totalMinor} currency={inv.currency} /></dd></div>
        <div className="flex justify-between"><dt>Paid</dt><dd><Money minor={inv.paidMinor} currency={inv.currency} /></dd></div>
        <div className="flex justify-between text-base font-bold"><dt>Balance due</dt><dd><Money minor={inv.status === "void" ? 0 : balance} currency={inv.currency} /></dd></div>
      </dl>

      {inv.status === "void" && (
        <p className="mt-4 rounded-md bg-slate-100 px-3 py-2 text-sm">
          Void <DateTime value={inv.voidedAt} dateOnly />{inv.voidReason ? ` — ${inv.voidReason}` : ""}. Nothing is owed on this invoice.
        </p>
      )}
      {(paymentMethods(settings).length > 0 || settings.paymentInstructions) && inv.status !== "void" && inv.status !== "paid" && (
        <div className="mt-6 rounded-lg bg-slate-50 p-4 text-sm print:break-inside-avoid">
          <h3 className="font-semibold">How to pay</h3>
          <div className="mt-2 grid gap-4 sm:grid-cols-3">
            {paymentMethods(settings).map((m) => (
              <div key={m.label}>
                <h4 className="font-semibold text-slate-800">{m.label}</h4>
                <dl className="mt-1 text-slate-700">
                  {m.lines.map(([k, v]) => (
                    <div key={k}><dt className="inline">{k}: </dt><dd className="inline font-medium text-slate-900">{v}</dd></div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          {settings.paymentInstructions && <p className="mt-3 whitespace-pre-line text-slate-700">{settings.paymentInstructions}</p>}
          <p className="mt-3 text-slate-600">Please quote <strong>{inv.number}</strong> as the payment reference.</p>
        </div>
      )}
      {inv.notes && <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{inv.notes}</p>}
    </article>
  );
}

