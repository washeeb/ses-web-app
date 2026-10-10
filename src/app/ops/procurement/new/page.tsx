import { eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { products, productVariants, stockLocations } from "@/server/db/schema";
import { requireActor } from "@/server/web/session";
import { authorize } from "@/server/authz/policy";
import { listSuppliers } from "@/server/modules/procurement";
import { getSettings } from "@/server/modules/settings";
import { formatMoney } from "@/server/lib/money";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { createPoAction } from "../actions";
import { PoBuilder } from "./po-builder";

export default async function NewPoPage() {
  const actor = await requireActor("operator");
  authorize(actor, "procurement.write");
  const db = getDb();
  const [supplierList, locations, variants, s] = await Promise.all([
    listSuppliers(db, actor),
    db.select().from(stockLocations).where(isNull(stockLocations.connectionId)),
    db
      .select({ id: productVariants.id, sku: productVariants.sku, name: productVariants.name, productName: products.name })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(eq(productVariants.tracksStock, true)),
    getSettings(db),
  ]);
  const active = supplierList.filter((x) => x.active);
  if (active.length === 0) return <EmptyState title="Add a supplier first">Go to Procurement → Suppliers.</EmptyState>;
  if (locations.length === 0) return <EmptyState title="No SES stock location">Create a warehouse location before raising purchase orders.</EmptyState>;
  return (
    <>
      <PageHeader title="New purchase order" description={`Orders of ${formatMoney(s.poApprovalThresholdMinor)} or more need approval by someone else before they can be sent.`} />
      <Card>
        <ActionForm action={createPoAction} submitLabel="Create draft">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Supplier" htmlFor="supplierId">
              <select id="supplierId" name="supplierId" className="field" required>
                {active.map((x) => (
                  <option key={x.id} value={x.id}>{x.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Receive into" htmlFor="locationId">
              <select id="locationId" name="locationId" className="field" required>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Expected delivery" htmlFor="expectedAt">
              <input id="expectedAt" name="expectedAt" type="date" className="field" />
            </Field>
          </div>
          <PoBuilder items={variants.map((v) => ({ id: v.id, label: `${v.productName} — ${v.name} (${v.sku})` }))} />
          <Field label="Notes for the supplier (optional)" htmlFor="notes">
            <textarea id="notes" name="notes" rows={2} className="field" maxLength={2000} />
          </Field>
        </ActionForm>
      </Card>
    </>
  );
}
