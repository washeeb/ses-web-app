import type { getQuote } from "@/server/modules/sales";
import { DateTime, Money, StatusBadge } from "./ui";

type Quote = Awaited<ReturnType<typeof getQuote>>;

/** Read-only quotation document shared by the operations and customer views. */
export function QuoteView({ q }: { q: Quote }) {
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">Quotation</p>
          <p className="text-xl font-bold">{q.number}</p>
          <p className="mt-1 text-sm">For <strong>{q.customerName}</strong></p>
        </div>
        <div className="text-right text-sm">
          <StatusBadge status={q.status} />
          <p className="mt-1 text-slate-500">Issued <DateTime value={q.sentAt ?? q.createdAt} dateOnly /></p>
          <p className="text-slate-500">Valid until <DateTime value={q.validUntil} dateOnly /></p>
        </div>
      </div>
      <div className="-mx-5 mt-6 overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Description</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Amount</th></tr>
          </thead>
          <tbody>
            {q.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.description}{!l.taxable && <span className="ml-1 text-xs text-slate-500">(not taxable)</span>}</td>
                <td className="text-right">{l.quantity}</td>
                <td className="text-right"><Money minor={l.unitPriceMinor} currency={q.currency} /></td>
                <td className="text-right"><Money minor={l.lineTotalMinor} currency={q.currency} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="ml-auto mt-4 max-w-sm space-y-1 text-sm">
        <div className="flex justify-between"><dt>Subtotal</dt><dd><Money minor={q.subtotalMinor} currency={q.currency} /></dd></div>
        {q.discountMinor > 0 && (
          <div className="flex justify-between"><dt>Discount ({q.discountBp / 100}%)</dt><dd>−<Money minor={q.discountMinor} currency={q.currency} /></dd></div>
        )}
        {q.taxBreakdown.map((t) => (
          <div key={t.code} className="flex justify-between text-slate-600"><dt>{t.name}</dt><dd><Money minor={t.amountMinor} currency={q.currency} /></dd></div>
        ))}
        <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold"><dt>Total</dt><dd><Money minor={q.totalMinor} currency={q.currency} /></dd></div>
      </dl>
      {q.notes && <p className="mt-4 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{q.notes}</p>}
    </div>
  );
}
