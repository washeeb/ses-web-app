import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { getProductAdmin } from "@/server/modules/catalogue";
import { listBrands, listCategoriesTree, listTags } from "@/server/modules/taxonomy";
import { ImageManager } from "@/components/image-manager";
import { listLocations, listMovements, MOVEMENT_LABELS } from "@/server/modules/inventory";
import { listSuppliers } from "@/server/modules/procurement";
import { LocationSelect } from "@/components/stock-ui";
import { stockAction, stockSettingsAction } from "../../inventory-actions";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { ActionForm } from "@/components/action-form";
import { AvailabilityBadge } from "@/components/availability";
import { Ago, Badge, Card, Field, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { addVariantAction, adjustStockAction, imageAction, priceChangeAction, updateProductAction, uploadImageAction } from "../../actions";
import { ProductFields, VariantFields } from "../product-fields";

export default async function ProductAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const data = await getProductAdmin(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const [categories, brands, allTags, locations] = await Promise.all([listCategoriesTree(db), listBrands(db), listTags(db), listLocations(db)]);
  const sesLocations = locations.filter((l) => !l.connectionId && l.active);
  const suppliers = can(actor, "procurement.read") ? await listSuppliers(db, actor) : [];
  const { product: p, variants, images, tags: productTagList } = data;
  const movements = can(actor, "inventory.read")
    ? Object.fromEntries(await Promise.all(variants.filter((v) => v.tracksStock).map(async (v) => [v.id, await listMovements(db, actor, v.id, 10)] as const)))
    : {};
  const canWrite = can(actor, "catalogue.write");
  const canAdjust = can(actor, "inventory.adjust");
  return (
    <>
      <PageHeader
        title={p.name}
        actions={
          <>
            <LiveRefresh topics={["catalogue", "stock", "approvals"]} />
            <StatusBadge status={p.status} />
            {p.sourceConnectionId && <Badge tone="purple">Partner-sourced</Badge>}
            {p.isDemo && <Badge tone="amber">Demo</Badge>}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Details">
          {canWrite ? (
            <ActionForm action={updateProductAction} submitLabel="Save">
              <input type="hidden" name="id" value={p.id} />
              <ProductFields categories={categories} brands={brands} tagNames={allTags.map((t) => t.name)} tags={productTagList.map((t) => t.name)} d={p} />
            </ActionForm>
          ) : (
            <p className="text-sm text-slate-700">{p.description}</p>
          )}
        </Card>
        <Card title="Pictures" className="xl:order-first xl:col-span-2">
          <ImageManager images={images} ownerType="product" ownerId={p.id} defaultAlt={p.name} canWrite={canWrite} uploadAction={uploadImageAction} imageAction={imageAction} />
        </Card>
        <div className="min-w-0 space-y-6">
          {variants.map((v) => (
            <Card key={v.id} title={`${v.name} · ${v.sku}`} actions={<AvailabilityBadge a={v.availability} showCount />}>
              <p className="text-sm">
                Price <strong><Money minor={v.priceMinor} currency={v.currency} /></strong>
                {v.billingPeriod && ` / ${v.billingPeriod}`} {v.taxable ? "" : "· not taxable"} {v.active ? "" : "· inactive"} {v.warrantyMonths > 0 && `· ${v.warrantyMonths}-month warranty`}
              </p>
              {v.mapping && (
                <p className="mt-1 text-xs text-slate-500">
                  Partner SKU {v.mapping.partnerSku} · partner cost {v.mapping.partnerCostMinor !== null ? <Money minor={v.mapping.partnerCostMinor} /> : "—"} · rule {v.mapping.priceRule.type === "markup" ? `+${v.mapping.priceRule.bp / 100}%` : "fixed margin"} · synced <Ago value={v.mapping.lastSyncedAt} />
                </p>
              )}
              {v.pendingPriceChange && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">Pending approval: {v.pendingPriceChange.summary}</p>}
              {v.tracksStock && (
                <TableWrap>
                  <table className="table mt-3">
                    <thead><tr><th>Location</th><th className="text-right">On hand</th><th className="text-right">Reserved</th><th>Updated</th></tr></thead>
                    <tbody>
                      {v.levels.map((l) => (
                        <tr key={l.id}>
                          <td>{l.locationName}</td>
                          <td className="text-right">{l.onHand}</td>
                          <td className="text-right">{l.reserved}</td>
                          <td className="text-xs"><Ago value={l.sourceUpdatedAt} /></td>
                        </tr>
                      ))}
                      {v.levels.length === 0 && <tr><td colSpan={4} className="text-slate-500">No stock records.</td></tr>}
                    </tbody>
                  </table>
                </TableWrap>
              )}
              {(movements[v.id]?.length ?? 0) > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-teal-700">Recent stock movements</summary>
                  <ul className="mt-2 space-y-1 text-xs">
                    {movements[v.id]!.map(({ m, locationName }) => (
                      <li key={m.id} className="flex flex-wrap justify-between gap-2">
                        <span>
                          <strong className={m.quantity > 0 ? "text-emerald-700" : "text-red-700"}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</strong> {MOVEMENT_LABELS[m.reason] ?? m.reason} · {locationName}
                          {m.note && <span className="text-slate-500"> — {m.note}</span>}
                        </span>
                        <Ago value={m.createdAt} />
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {canWrite && (
                  <ActionForm action={priceChangeAction} submitLabel="Change price" submitClassName="btn btn-ghost">
                    <input type="hidden" name="variantId" value={v.id} />
                    <input type="hidden" name="productId" value={p.id} />
                    <Field label="New price (GHS)" htmlFor={`price-${v.id}`}>
                      <input id={`price-${v.id}`} name="price" className="field" inputMode="decimal" required defaultValue={(v.priceMinor / 100).toFixed(2)} />
                    </Field>
                    <Field label="Reason" htmlFor={`reason-${v.id}`}>
                      <input id={`reason-${v.id}`} name="reason" className="field" required minLength={3} />
                    </Field>
                  </ActionForm>
                )}
                {canAdjust && v.tracksStock && sesLocations.length > 0 && (
                  <ActionForm action={adjustStockAction} submitLabel="Set stock count" submitClassName="btn btn-ghost">
                    <input type="hidden" name="variantId" value={v.id} />
                    <input type="hidden" name="productId" value={p.id} />
                    <Field label="SES location" htmlFor={`loc-${v.id}`}>
                      <select id={`loc-${v.id}`} name="locationId" className="field">
                        {sesLocations.map((l) => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Counted quantity" htmlFor={`oh-${v.id}`}>
                        <input id={`oh-${v.id}`} name="onHand" type="number" min={0} className="field" required />
                      </Field>
                      <Field label="Reason" htmlFor={`sr-${v.id}`}>
                        <input id={`sr-${v.id}`} name="reason" className="field" required minLength={3} placeholder="Cycle count" />
                      </Field>
                    </div>
                  </ActionForm>
                )}
                {canAdjust && v.tracksStock && sesLocations.length > 0 && (
                  <ActionForm action={stockAction} submitLabel="Receive" submitClassName="btn btn-ghost" resetOnSuccess>
                    <input type="hidden" name="op" value="receive" />
                    <input type="hidden" name="variantId" value={v.id} />
                    <LocationSelect id={`rl-${v.id}`} label="Receive into" locations={sesLocations} />
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Quantity" htmlFor={`rq-${v.id}`}><input id={`rq-${v.id}`} name="quantity" type="number" min={1} className="field" required /></Field>
                      <Field label="Unit cost (GHS)" htmlFor={`ruc-${v.id}`}><input id={`ruc-${v.id}`} name="unitCost" className="field" inputMode="decimal" /></Field>
                    </div>
                    {v.serialTracked && <Field label="Serial numbers" htmlFor={`rs-${v.id}`}><textarea id={`rs-${v.id}`} name="serials" rows={2} className="field font-mono text-sm uppercase" required /></Field>}
                    <Field label="Note" htmlFor={`rn-${v.id}`}><input id={`rn-${v.id}`} name="note" className="field" maxLength={300} placeholder="Supplier, delivery note" /></Field>
                  </ActionForm>
                )}
              </div>
              {canWrite && v.tracksStock && (
                <details className="mt-4 rounded-lg border border-slate-200 p-3 text-sm">
                  <summary className="cursor-pointer font-medium text-teal-700">Stock settings (barcode, reorder, serials){v.costMinor !== null && <span className="font-normal text-slate-600"> · average cost {(v.costMinor / 100).toFixed(2)}</span>}</summary>
                  <ActionForm action={stockSettingsAction} submitLabel="Save stock settings" submitClassName="btn btn-ghost" className="mt-3 space-y-3">
                    <input type="hidden" name="variantId" value={v.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Barcode (EAN/UPC)" htmlFor={`bc-${v.id}`}><input id={`bc-${v.id}`} name="barcode" className="field font-mono" maxLength={40} defaultValue={v.barcode ?? ""} /></Field>
                      <Field label="Preferred supplier" htmlFor={`ps-${v.id}`}>
                        <select id={`ps-${v.id}`} name="preferredSupplierId" className="field" defaultValue={v.preferredSupplierId ?? ""}>
                          <option value="">None</option>
                          {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </Field>
                      <Field label="Reorder at (SES units available)" htmlFor={`rp-${v.id}`}><input id={`rp-${v.id}`} name="reorderPoint" type="number" min={0} className="field" defaultValue={v.reorderPoint ?? ""} /></Field>
                      <Field label="Usual order quantity" htmlFor={`roq-${v.id}`}><input id={`roq-${v.id}`} name="reorderQty" type="number" min={1} className="field" defaultValue={v.reorderQty ?? ""} /></Field>
                      <Field label="Lead time (days)" htmlFor={`lt-${v.id}`}><input id={`lt-${v.id}`} name="leadTimeDays" type="number" min={0} max={365} className="field" defaultValue={v.leadTimeDays ?? ""} /></Field>
                    </div>
                    <label className="flex items-center gap-2"><input type="checkbox" name="serialTracked" defaultChecked={v.serialTracked} /> Track serial numbers (recorded on receipt, sale and the warranty)</label>
                  </ActionForm>
                </details>
              )}
            </Card>
          ))}
          {canWrite && (
            <Card title="Add an option">
              <ActionForm action={addVariantAction} submitLabel="Add option" resetOnSuccess>
                <input type="hidden" name="productId" value={p.id} />
                <VariantFields />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
