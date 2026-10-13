import { Field } from "./ui";

type Loc = { id: string; name: string; active: boolean; sellable: boolean; isDefault: boolean; connectionId?: string | null };
export type ItemOption = { sku: string; name: string };

export function LocationSelect({ id, name = "locationId", label, locations, defaultValue, required = true, includeAny = false }: { id: string; name?: string; label: string; locations: Loc[]; defaultValue?: string; required?: boolean; includeAny?: boolean }) {
  // Partner locations (fed by a connection) are never chosen for manual stock work.
  const active = locations.filter((l) => l.active && !l.connectionId);
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} name={name} className="field" defaultValue={defaultValue ?? (includeAny ? "" : active.find((l) => l.isDefault)?.id)} required={required}>
        {includeAny && <option value="">All locations</option>}
        {active.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
            {l.isDefault ? " (default)" : ""}
            {l.sellable ? "" : " — not for sale"}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** One datalist of all items, so every SKU box offers "SKU — name" suggestions (scanners just type the code). */
export function ItemDatalist({ items, id = "item-codes" }: { items: ItemOption[]; id?: string }) {
  return (
    <datalist id={id}>
      {items.map((i) => (
        <option key={i.sku} value={`${i.sku} — ${i.name}`} />
      ))}
    </datalist>
  );
}

/**
 * Fixed rows of item / quantity (/ unit cost / serials). Plain form fields, so it works without JavaScript and with
 * a barcode scanner (scan into the SKU box, Tab to quantity). Empty rows are ignored.
 */
export function ItemRows({ count = 8, withCost = false, withSerials = false, listId = "item-codes", defaults = [] }: { count?: number; withCost?: boolean; withSerials?: boolean; listId?: string; defaults?: { code: string; qty?: number; cost?: string }[] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Item (SKU or barcode)</th>
          <th className="w-24">Qty</th>
          {withCost && <th className="w-32">Unit cost (GHS)</th>}
          {withSerials && <th>Serial numbers</th>}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: count }, (_, i) => (
          <tr key={i}>
            <td>
              <label className="sr-only" htmlFor={`code_${i}`}>Item {i + 1}</label>
              <input id={`code_${i}`} name={`code_${i}`} className="field font-mono text-sm" list={listId} autoComplete="off" defaultValue={defaults[i]?.code} />
            </td>
            <td>
              <label className="sr-only" htmlFor={`qty_${i}`}>Quantity {i + 1}</label>
              <input id={`qty_${i}`} name={`qty_${i}`} type="number" min={1} className="field" defaultValue={defaults[i]?.qty} />
            </td>
            {withCost && (
              <td>
                <label className="sr-only" htmlFor={`cost_${i}`}>Unit cost {i + 1}</label>
                <input id={`cost_${i}`} name={`cost_${i}`} className="field" inputMode="decimal" defaultValue={defaults[i]?.cost} />
              </td>
            )}
            {withSerials && (
              <td>
                <label className="sr-only" htmlFor={`serials_${i}`}>Serial numbers {i + 1}</label>
                <input id={`serials_${i}`} name={`serials_${i}`} className="field font-mono text-xs uppercase" placeholder="Only for serial-tracked items" />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const ADJUST_REASON_OPTIONS: [string, string][] = [
  ["damaged", "Damaged (remove)"],
  ["lost", "Lost or stolen (remove)"],
  ["expired", "Expired / obsolete (remove)"],
  ["internal_use", "Used internally (remove)"],
  ["supplier_return", "Returned to supplier (remove)"],
  ["found", "Found (add)"],
  ["correction", "Correction (+ or −)"],
];
