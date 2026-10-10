import type { getReturn } from "@/server/modules/returns";
import { DateTime, Money, StatusBadge, TableWrap } from "./ui";

type R = Awaited<ReturnType<typeof getReturn>>;

export const RESOLUTION_LABEL: Record<string, string> = { refund: "Refund", replacement: "Replacement", repair: "Repair" };
export const KIND_LABEL: Record<string, string> = { return: "Return", warranty: "Warranty claim" };

/** Read-only summary of a return, shared by staff and customer pages. */
export function ReturnView({ d }: { d: R }) {
  const { r, order } = d;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">{KIND_LABEL[r.kind]} · requested resolution: {RESOLUTION_LABEL[r.resolution]}</p>
          <p className="text-xl font-bold">{r.number}</p>
          <p className="text-sm">Order {order.number} · {d.customerName} · requested by {d.requesterName}, <DateTime value={r.createdAt} /></p>
        </div>
        <StatusBadge status={r.status} />
      </div>
      <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm">{r.reason}</p>
      <TableWrap>
        <table className="table">
          <thead><tr><th>Item</th><th className="text-right">Quantity</th></tr></thead>
          <tbody>
            {d.lines.map(({ rl, line }) => (
              <tr key={rl.id}><td>{line.description}</td><td className="text-right">{rl.quantity}</td></tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {r.resolution === "refund" && (
        <p className="text-sm">
          Refund {r.refundMinor !== null ? "amount" : "estimate"}: <strong><Money minor={r.refundMinor ?? d.refundEstimateMinor} currency={order.currency} /></strong>
          <span className="text-slate-500"> (share of what was paid, including discount and taxes)</span>
        </p>
      )}
      {r.decisionNote && <p className="text-sm italic text-slate-700">Note: {r.decisionNote}</p>}
      {r.receivedAt && <p className="text-xs text-slate-500">Items received <DateTime value={r.receivedAt} />{r.restocked && " · restocked"}</p>}
      {r.completedAt && <p className="text-xs text-slate-500">Completed <DateTime value={r.completedAt} /></p>}
    </div>
  );
}
