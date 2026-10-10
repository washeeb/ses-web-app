import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { getProductAdmin, listCategories } from "@/server/modules/catalogue";
import { listLocations, listMovements } from "@/server/modules/inventory";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { ActionForm } from "@/components/action-form";
import { AvailabilityBadge } from "@/components/availability";
import { Ago, Badge, Card, Field, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { addVariantAction, adjustStockAction, priceChangeAction, updateProductAction } from "../../actions";
import { ProductFields, VariantFields } from "../product-fields";

export default async function ProductAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const data = await getProductAdmin(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const [categories, locations] = await Promise.all([listCategories(db), listLocations(db)]);
  const sesLocations = locations.filter((l) => !l.connectionId);
  const { product: p, variants } = data;
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
              <ProductFields categories={categories} d={p} />
            </ActionForm>
          ) : (
            <p className="text-sm text-slate-700">{p.description}</p>
          )}
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
                          <strong className={m.quantity > 0 ? "text-emerald-700" : "text-red-700"}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</strong> {m.reason} · {locationName}
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
              </div>
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
