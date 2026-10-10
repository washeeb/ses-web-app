"use client";

import { useMemo, useState } from "react";

export interface VariantOption {
  id: string;
  label: string;
  priceMinor: number;
}

type Line = { key: number; kind: "catalogue"; variantId: string; quantity: number } | { key: number; kind: "custom"; description: string; unitPrice: string; quantity: number; taxable: boolean };

const fmt = (minor: number) => new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", currencyDisplay: "code" }).format(minor / 100);

/** Builds the quotation lines; totals here are a preview — the server recalculates everything. */
export function QuoteBuilder({ variants }: { variants: VariantOption[] }) {
  const [lines, setLines] = useState<Line[]>([{ key: 1, kind: "catalogue", variantId: variants[0]?.id ?? "", quantity: 1 }]);
  const [nextKey, setNextKey] = useState(2);
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? ({ ...l, ...patch } as Line) : l)));
  const add = (kind: Line["kind"]) => {
    setLines((ls) => [...ls, kind === "catalogue" ? { key: nextKey, kind, variantId: variants[0]?.id ?? "", quantity: 1 } : { key: nextKey, kind, description: "", unitPrice: "", quantity: 1, taxable: true }]);
    setNextKey((k) => k + 1);
  };
  const payload = useMemo(
    () =>
      JSON.stringify(
        lines.map((l) =>
          l.kind === "catalogue"
            ? { variantId: l.variantId, quantity: l.quantity }
            : { description: l.description, quantity: l.quantity, unitPriceMinor: Math.round(Number(l.unitPrice || "0") * 100), taxable: l.taxable },
        ),
      ),
    [lines],
  );
  const subtotal = lines.reduce((sum, l) => sum + l.quantity * (l.kind === "catalogue" ? (variants.find((v) => v.id === l.variantId)?.priceMinor ?? 0) : Math.round(Number(l.unitPrice || "0") * 100)), 0);

  return (
    <fieldset className="space-y-3">
      <legend className="field-label">Lines</legend>
      <input type="hidden" name="lines" value={payload} />
      {lines.map((l, i) => (
        <div key={l.key} className="grid items-end gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_7rem_auto]">
          {l.kind === "catalogue" ? (
            <div>
              <label className="field-label" htmlFor={`v-${l.key}`}>Product {i + 1}</label>
              <select id={`v-${l.key}`} className="field" value={l.variantId} onChange={(e) => update(l.key, { variantId: e.target.value })}>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>{v.label} — {fmt(v.priceMinor)}</option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
              <div>
                <label className="field-label" htmlFor={`d-${l.key}`}>Custom item {i + 1}</label>
                <input id={`d-${l.key}`} className="field" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} placeholder="e.g. On-site installation (2 days)" />
              </div>
              <div>
                <label className="field-label" htmlFor={`p-${l.key}`}>Unit price (GHS)</label>
                <input id={`p-${l.key}`} className="field" inputMode="decimal" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={l.taxable} onChange={(e) => update(l.key, { taxable: e.target.checked })} /> Taxable
              </label>
            </div>
          )}
          <div>
            <label className="field-label" htmlFor={`q-${l.key}`}>Qty</label>
            <input id={`q-${l.key}`} type="number" min={1} className="field" value={l.quantity} onChange={(e) => update(l.key, { quantity: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} disabled={lines.length === 1} aria-label={`Remove line ${i + 1}`}>
            Remove
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => add("catalogue")}>+ Catalogue item</button>
        <button type="button" className="btn btn-ghost" onClick={() => add("custom")}>+ Custom item</button>
      </div>
      <p className="text-sm text-slate-600">Subtotal before discount and taxes: <strong>{fmt(subtotal)}</strong></p>
    </fieldset>
  );
}
