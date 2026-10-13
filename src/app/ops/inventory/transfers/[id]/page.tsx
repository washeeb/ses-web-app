import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getTransfer, serialsInStock } from "@/server/modules/inventory";
import { ActionForm } from "@/components/action-form";
import { PrintButton } from "@/components/print-button";
import { Card, DateTime, Field, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { transferAction } from "../../../inventory-actions";

export const metadata: Metadata = { title: "Transfer" };

export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const t = await getTransfer(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const write = can(actor, "inventory.adjust");
  const choices = t.status === "draft" ? await Promise.all(t.lines.map((l) => (l.serialTracked ? serialsInStock(db, l.line.variantId, t.fromLocationId) : Promise.resolve([])))) : [];
  const hidden = (op: string) => <><input type="hidden" name="id" value={t.id} /><input type="hidden" name="op" value={op} /></>;
  return (
    <>
      <Link href="/ops/inventory/transfers" className="text-sm text-teal-700 hover:underline print:hidden">← Transfers</Link>
      <div className="mt-4">
        <PageHeader title={`Transfer ${t.number}`} description={<>{t.fromName} → {t.toName}</>} actions={<><StatusBadge status={t.status} /><PrintButton label="Print delivery note" /></>} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card title="Items">
          <TableWrap>
            <table className="table">
              <thead><tr><th>SKU</th><th>Item</th><th className="text-right">Qty</th><th>Serial numbers</th></tr></thead>
              <tbody>
                {t.lines.map((l) => (
                  <tr key={l.line.id}>
                    <td className="font-mono text-xs">{l.sku}</td>
                    <td>{l.productName}{l.variantName !== "Standard" && ` — ${l.variantName}`}</td>
                    <td className="text-right tabular-nums">{l.line.quantity}</td>
                    <td className="font-mono text-xs">{l.line.serials.join(", ") || (l.serialTracked ? "to be entered" : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
            <div><dt className="font-semibold">Created</dt><dd>{t.createdByName} · <DateTime value={t.createdAt} /></dd></div>
            <div><dt className="font-semibold">Sent</dt><dd>{t.dispatchedAt ? <>{t.dispatchedByName} · <DateTime value={t.dispatchedAt} /></> : "—"}</dd></div>
            <div><dt className="font-semibold">Received</dt><dd>{t.receivedAt ? <>{t.receivedByName} · <DateTime value={t.receivedAt} /></> : "—"}</dd></div>
          </dl>
          {t.note && <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{t.note}</p>}
          <div className="mt-8 hidden grid-cols-2 gap-10 text-sm print:grid">
            <p className="border-t border-slate-400 pt-1">Released by (name, signature)</p>
            <p className="border-t border-slate-400 pt-1">Received by (name, signature)</p>
          </div>
        </Card>
        {write && ["draft", "in_transit"].includes(t.status) && (
          <div className="space-y-6 print:hidden">
            {t.status === "draft" && (
              <Card title="Send">
                <ActionForm action={transferAction} submitLabel="Send — stock leaves the source" submitClassName="btn btn-primary w-full">
                  {hidden("dispatch")}
                  {t.lines.map((l, i) =>
                    l.serialTracked && l.line.serials.length === 0 ? (
                      <Field key={l.line.id} label={`Serials for ${l.sku} × ${l.line.quantity}`} htmlFor={`s-${l.line.id}`} hint={choices[i]!.length ? `In stock there: ${choices[i]!.slice(0, 10).map((c) => c.serial).join(", ")}` : undefined}>
                        <textarea id={`s-${l.line.id}`} name={`serials_${l.line.id}`} rows={2} className="field font-mono text-sm uppercase" required />
                      </Field>
                    ) : null,
                  )}
                </ActionForm>
              </Card>
            )}
            {t.status === "in_transit" && (
              <Card title="Receive">
                <p className="mb-3 text-sm text-slate-600">Check the items against this note, then confirm.</p>
                <ActionForm action={transferAction} submitLabel="Received at destination" submitClassName="btn btn-accent w-full">{hidden("receive")}</ActionForm>
              </Card>
            )}
            <Card title="Cancel">
              <ActionForm action={transferAction} submitLabel="Cancel transfer" submitClassName="btn btn-danger w-full" confirm="Cancel this transfer? Stock already sent returns to the source.">
                {hidden("cancel")}
                <Field label="Reason" htmlFor="reason"><input id="reason" name="reason" className="field" required minLength={3} /></Field>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
