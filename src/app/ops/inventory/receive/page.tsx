import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { itemOptions, listLocations } from "@/server/modules/inventory";
import { ActionForm } from "@/components/action-form";
import { ScanInput } from "@/components/scan-input";
import { ADJUST_REASON_OPTIONS, ItemDatalist, LocationSelect } from "@/components/stock-ui";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { stockAction } from "../../inventory-actions";

export const metadata: Metadata = { title: "Receive & adjust stock" };

export default async function ReceivePage() {
  const actor = await requireActor("operator");
  if (!can(actor, "inventory.adjust")) return <EmptyState title="You can't open this page" />;
  const db = getDb();
  const [locations, items] = await Promise.all([listLocations(db), itemOptions(db)]);
  return (
    <>
      <PageHeader
        title="Receive & adjust stock"
        description={<>Scan or type a SKU or barcode. Deliveries ordered on a purchase order are received in <Link href="/ops/procurement" className="text-teal-700 underline">Procurement</Link> instead, so costs and quantities match the order. Partner stock cannot be changed here.</>}
      />
      <ItemDatalist items={items} />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Receive a delivery">
          <ActionForm action={stockAction} submitLabel="Receive" resetOnSuccess>
            <input type="hidden" name="op" value="receive" />
            <ScanInput label="Item (scan or type)" autoFocus />
            <LocationSelect id="r-loc" label="Into" locations={locations} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity" htmlFor="r-qty"><input id="r-qty" name="quantity" type="number" min={1} className="field" required /></Field>
              <Field label="Unit cost (GHS)" htmlFor="r-cost" hint="Updates the average cost."><input id="r-cost" name="unitCost" className="field" inputMode="decimal" /></Field>
            </div>
            <Field label="Serial numbers" htmlFor="r-serials" hint="Serial-tracked items only: one per unit, scan each.">
              <textarea id="r-serials" name="serials" rows={3} className="field font-mono text-sm uppercase" />
            </Field>
            <Field label="Supplier / note" htmlFor="r-note"><input id="r-note" name="note" className="field" maxLength={300} /></Field>
          </ActionForm>
        </Card>
        <Card title="Adjust (damage, loss, found …)">
          <ActionForm action={stockAction} submitLabel="Record adjustment" resetOnSuccess>
            <input type="hidden" name="op" value="adjust" />
            <ScanInput label="Item (scan or type)" />
            <LocationSelect id="a-loc" label="At" locations={locations} />
            <Field label="Reason" htmlFor="a-reason">
              <select id="a-reason" name="reason" className="field" required>
                {ADJUST_REASON_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Units" htmlFor="a-qty" hint="For a correction, use a minus sign to remove."><input id="a-qty" name="quantity" type="number" className="field" required /></Field>
            <Field label="Serial numbers" htmlFor="a-serials" hint="Serial-tracked items only."><textarea id="a-serials" name="serials" rows={2} className="field font-mono text-sm uppercase" /></Field>
            <Field label="What happened" htmlFor="a-note"><input id="a-note" name="note" className="field" required minLength={3} maxLength={300} /></Field>
          </ActionForm>
        </Card>
        <Card title="Quick count of one item">
          <p className="mb-3 text-sm text-slate-600">Sets the quantity at one location. For a full stocktake, use <Link href="/ops/inventory/counts" className="text-teal-700 underline">Stocktakes</Link>.</p>
          <ActionForm action={stockAction} submitLabel="Save count" resetOnSuccess>
            <input type="hidden" name="op" value="count" />
            <ScanInput label="Item (scan or type)" />
            <LocationSelect id="c-loc" label="At" locations={locations} />
            <Field label="Counted" htmlFor="c-qty"><input id="c-qty" name="quantity" type="number" min={0} className="field" required /></Field>
            <Field label="Reason" htmlFor="c-note"><input id="c-note" name="note" className="field" required minLength={3} maxLength={300} /></Field>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
