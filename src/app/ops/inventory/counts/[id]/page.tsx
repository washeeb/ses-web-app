import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getCount } from "@/server/modules/inventory";
import { ActionForm } from "@/components/action-form";
import { ScanInput } from "@/components/scan-input";
import { Card, DateTime, Field, Money, PageHeader, Stat, StatusBadge, TableWrap } from "@/components/ui";
import { countAction } from "../../../inventory-actions";

export const metadata: Metadata = { title: "Stocktake" };

export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const c = await getCount(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const open = c.status === "open";
  const write = open && can(actor, "inventory.adjust");
  const counted = c.lines.filter((l) => l.line.counted !== null);
  // Expected figures are hidden while a blind count is open.
  const showExpected = !open || !c.blind;
  const diff = (l: (typeof c.lines)[number]) => (l.line.counted === null ? null : l.line.counted - (l.line.systemAtCount ?? l.line.expected));
  const varianceValue = counted.reduce((a, l) => a + (diff(l) ?? 0) * (l.line.unitCostMinor ?? 0), 0);
  const hidden = (op: string) => <><input type="hidden" name="id" value={c.id} /><input type="hidden" name="op" value={op} /></>;
  return (
    <>
      <Link href="/ops/inventory/counts" className="text-sm text-teal-700 hover:underline">← Stocktakes</Link>
      <div className="mt-4">
        <PageHeader title={`Stocktake ${c.number}`} description={<>{c.locationName}{c.blind ? " · blind count" : ""} · started <DateTime value={c.createdAt} />{c.note ? ` · ${c.note}` : ""}</>} actions={<StatusBadge status={c.status} />} />
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Items counted" value={`${counted.length} of ${c.lines.length}`} />
        {showExpected && <Stat label="Items with a difference" value={counted.filter((l) => diff(l) !== 0).length} tone={counted.some((l) => diff(l) !== 0) ? "amber" : undefined} />}
        {showExpected && <Stat label={open ? "Difference so far (at cost)" : "Difference posted (at cost)"} value={<Money minor={open ? varianceValue : (c.varianceValueMinor ?? 0)} />} tone={varianceValue < 0 ? "red" : undefined} />}
      </div>
      {write && (
        <Card title="Scan" className="mb-6">
          <ActionForm action={countAction} submitLabel="Add" resetOnSuccess className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
            {hidden("scan")}
            <ScanInput label="Scan each unit, or type a SKU and a quantity" autoFocus />
            <Field label="Quantity" htmlFor="scanQty"><input id="scanQty" name="scanQty" type="number" min={1} defaultValue={1} className="field" /></Field>
          </ActionForm>
        </Card>
      )}
      <Card title="Count sheet">
        <ActionForm action={countAction} submitLabel={write ? "Save counts" : undefined} submitClassName="btn btn-primary">
          {hidden("save")}
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>SKU</th><th>Item</th>
                  {showExpected && <th className="text-right">Expected</th>}
                  <th className="w-32 text-right">Counted</th>
                  {showExpected && <th className="text-right">Difference</th>}
                </tr>
              </thead>
              <tbody>
                {c.lines.map((l) => {
                  const d = diff(l);
                  return (
                    <tr key={l.line.id}>
                      <td className="font-mono text-xs">{l.sku}</td>
                      <td>{l.productName}{l.variantName !== "Standard" && ` — ${l.variantName}`}</td>
                      {showExpected && <td className="text-right tabular-nums">{l.line.expected}</td>}
                      <td className="text-right">
                        {write ? (
                          <>
                            <label className="sr-only" htmlFor={`count_${l.line.variantId}`}>Counted {l.sku}</label>
                            <input id={`count_${l.line.variantId}`} name={`count_${l.line.variantId}`} type="number" min={0} className="field w-28 text-right" defaultValue={l.line.counted ?? ""} />
                          </>
                        ) : (l.line.counted ?? "—")}
                      </td>
                      {showExpected && <td className={`text-right tabular-nums ${d && d < 0 ? "text-red-700" : d ? "text-emerald-700" : ""}`}>{d === null ? "" : d > 0 ? `+${d}` : d}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </ActionForm>
      </Card>
      {write && (
        <div className="mt-6 flex flex-wrap gap-3">
          <ActionForm action={countAction} submitLabel="Finish and post differences" submitClassName="btn btn-accent" confirm="Post the differences to stock? Items not counted are left unchanged.">{hidden("complete")}</ActionForm>
          <ActionForm action={countAction} submitLabel="Cancel stocktake" submitClassName="btn btn-ghost" confirm="Cancel this stocktake? Nothing will change.">{hidden("cancel")}</ActionForm>
        </div>
      )}
    </>
  );
}
