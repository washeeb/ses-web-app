"use client";

import { useMemo, useState } from "react";

export interface StockItem {
  id: string;
  label: string;
}

type Line = { key: number; variantId: string; description: string; quantity: number; unitCost: string };

const fmt = (minor: number) => new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", currencyDisplay: "code" }).format(minor / 100);
const toMinor = (v: string) => Math.round(Number(v.replace(/,/g, "") || "0") * 100);

/** Purchase order lines. Totals here are a preview; the server recalculates. */
export function PoBuilder({ items }: { items: StockItem[] }) {
  const blank = (key: number): Line => ({ key, variantId: items[0]?.id ?? "", description: "", quantity: 1, unitCost: "" });
  const [lines, setLines] = useState<Line[]>([blank(1)]);
  const [next, setNext] = useState(2);
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const payload = useMemo(
    () => JSON.stringify(lines.map((l) => ({ variantId: l.variantId || null, description: l.description, quantity: l.quantity, unitCostMinor: toMinor(l.unitCost) }))),
    [lines],
  );
  const total = lines.reduce((a, l) => a + l.quantity * toMinor(l.unitCost), 0);
  return (
    <fieldset className="space-y-3">
      <legend className="field-label">Lines</legend>
      <input type="hidden" name="lines" value={payload} />
      {lines.map((l, i) => (
        <div key={l.key} className="grid items-end gap-2 rounded-lg border border-slate-200 p-3 md:grid-cols-[1.4fr_1fr_6rem_8rem_auto]">
          <div>
            <label className="field-label" htmlFor={`v-${l.key}`}>Item {i + 1}</label>
            <select id={`v-${l.key}`} className="field" value={l.variantId} onChange={(e) => update(l.key, { variantId: e.target.value })}>
              {items.map((it) => (
                <option key={it.id} value={it.id}>{it.label}</option>
              ))}
              <option value="">Other (not a stocked product)</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor={`d-${l.key}`}>{l.variantId ? "Description (optional)" : "Description"}</label>
            <input id={`d-${l.key}`} className="field" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} />
          </div>
          <div>
            <label className="field-label" htmlFor={`q-${l.key}`}>Qty</label>
            <input id={`q-${l.key}`} type="number" min={1} className="field" value={l.quantity} onChange={(e) => update(l.key, { quantity: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
          <div>
            <label className="field-label" htmlFor={`c-${l.key}`}>Unit cost (GHS)</label>
            <input id={`c-${l.key}`} inputMode="decimal" className="field" value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })} />
          </div>
          <button type="button" className="btn btn-ghost" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove line ${i + 1}`}>
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          setLines((ls) => [...ls, blank(next)]);
          setNext((n) => n + 1);
        }}
      >
        + Add line
      </button>
      <p className="text-sm text-slate-600">
        Order total: <strong>{fmt(total)}</strong> (excluding supplier taxes)
      </p>
    </fieldset>
  );
}
