import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getPurchaseOrder } from "@/server/modules/procurement";
import { ActionForm } from "@/components/action-form";
import { DocumentsPanel } from "@/components/documents-panel";
import { Card, DateTime, Field, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { poAction, receiveAction } from "../actions";

export default async function PoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const d = await getPurchaseOrder(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const { po, supplier } = d;
  const write = can(actor, "procurement.write");
  const receivable = can(actor, "procurement.receive") && ["approved", "sent", "partially_received"].includes(po.status);
  const outstanding = d.lines.filter(({ line }) => line.receivedQuantity < line.quantity);
  return (
    <>
      <PageHeader
        title={`Purchase order ${po.number}`}
        description={
          <>
            Supplier: {supplier.name} · receive into {d.locationName} · raised by {d.creatorName}, <DateTime value={po.createdAt} />
          </>
        }
        actions={
          <>
            <LiveRefresh topics={["approvals", "stock"]} />
            <StatusBadge status={po.status} />
            {write && po.status === "draft" && (
              <ActionForm action={poAction} inline submitLabel="Submit">
                <input type="hidden" name="id" value={po.id} />
                <input type="hidden" name="op" value="submit" />
              </ActionForm>
            )}
            {write && po.status === "approved" && (
              <ActionForm action={poAction} inline submitLabel={supplier.email ? "Send to supplier" : "Mark as sent"} submitClassName="btn btn-accent">
                <input type="hidden" name="id" value={po.id} />
                <input type="hidden" name="op" value="send" />
              </ActionForm>
            )}
          </>
        }
      />
      {po.status === "pending_approval" && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Waiting for approval.{" "}
          {can(actor, "approvals.read") && (
            <Link className="font-semibold underline" href="/ops/approvals">
              Open approvals
            </Link>
          )}
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Card title="Lines">
            <TableWrap>
              <table className="table">
                <thead>
                  <tr><th>Item</th><th className="text-right">Ordered</th><th className="text-right">Received</th><th className="text-right">Unit cost</th><th className="text-right">Amount</th></tr>
                </thead>
                <tbody>
                  {d.lines.map(({ line, sku }) => (
                    <tr key={line.id}>
                      <td>
                        {line.description}
                        {!sku && <span className="ml-1 text-xs text-slate-500">(not stocked)</span>}
                      </td>
                      <td className="text-right">{line.quantity}</td>
                      <td className="text-right">{line.receivedQuantity}</td>
                      <td className="text-right"><Money minor={line.unitCostMinor} currency={po.currency} /></td>
                      <td className="text-right"><Money minor={line.lineTotalMinor} currency={po.currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="mt-3 text-right font-bold">
              Total <Money minor={po.totalMinor} currency={po.currency} />
            </p>
            {po.notes && <p className="mt-3 whitespace-pre-line rounded bg-slate-50 p-3 text-sm">{po.notes}</p>}
          </Card>
          {receivable && outstanding.length > 0 && (
            <Card title="Receive goods">
              <ActionForm action={receiveAction} submitLabel="Record goods receipt" submitClassName="btn btn-accent">
                <input type="hidden" name="id" value={po.id} />
                <div className="space-y-2">
                  {outstanding.map(({ line, serialTracked }) => (
                    <div key={line.id} className="grid items-center gap-2 sm:grid-cols-[1fr_8rem]">
                      <input type="hidden" name="lineId" value={line.id} />
                      <label htmlFor={`qty-${line.id}`} className="text-sm">
                        {line.description} <span className="text-slate-500">({line.quantity - line.receivedQuantity} outstanding)</span>
                      </label>
                      <input id={`qty-${line.id}`} name={`qty-${line.id}`} type="number" min={0} max={line.quantity - line.receivedQuantity} defaultValue={line.quantity - line.receivedQuantity} className="field" />
                      {serialTracked && (
                        <div className="sm:col-span-2">
                          <label htmlFor={`serials-${line.id}`} className="text-xs font-medium">Serial numbers (one per unit received)</label>
                          <textarea id={`serials-${line.id}`} name={`serials-${line.id}`} rows={2} className="field font-mono text-sm uppercase" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <Field label="Delivery note / remarks" htmlFor="grn-notes">
                  <input id="grn-notes" name="notes" className="field" />
                </Field>
              </ActionForm>
            </Card>
          )}
        </div>
        <div className="min-w-0 space-y-6">
          <Card title="Supplier">
            <p className="font-medium">{supplier.name}</p>
            <p className="text-sm text-slate-600">{[supplier.contactName, supplier.email, supplier.phone].filter(Boolean).join(" · ")}</p>
            <p className="text-xs text-slate-500">
              Payment terms: {supplier.paymentTermsDays} days{supplier.taxId && ` · TIN ${supplier.taxId}`}
            </p>
          </Card>
          <Card title="Goods receipts">
            {d.receipts.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing received yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {d.receipts.map(({ r, receiverName }) => (
                  <li key={r.id}>
                    {r.number} · {receiverName} · <DateTime value={r.createdAt} />
                    {r.notes && <span className="block text-xs text-slate-500">{r.notes}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {d.approvals.length > 0 && (
            <Card title="Approval history">
              <ul className="space-y-2 text-sm">
                {d.approvals.map((a) => (
                  <li key={a.id}>
                    <StatusBadge status={a.status} /> <span className="text-slate-600">{a.summary}</span>
                    {a.decisionNote && <span className="block text-xs italic">“{a.decisionNote}”</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <DocumentsPanel actor={actor} entityType="purchase_order" entityId={po.id} path={`/ops/procurement/${po.id}`} />
          {write && ["draft", "pending_approval", "approved", "sent"].includes(po.status) && (
            <Card title="Cancel">
              <ActionForm action={poAction} submitLabel="Cancel purchase order" submitClassName="btn btn-danger w-full" confirm="Cancel this purchase order?">
                <input type="hidden" name="id" value={po.id} />
                <input type="hidden" name="op" value="cancel" />
                <label className="field-label" htmlFor="reason">Reason</label>
                <input id="reason" name="reason" className="field" required minLength={3} />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
