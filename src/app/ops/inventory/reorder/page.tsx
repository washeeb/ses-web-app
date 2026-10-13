import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { reorderList } from "@/server/modules/inventory";
import { listSuppliers, onOrderByVariant } from "@/server/modules/procurement";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, Money, PageHeader, TableWrap } from "@/components/ui";
import { draftFromReorderAction } from "../../inventory-actions";

export const metadata: Metadata = { title: "Reorder" };

export default async function ReorderPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "inventory.read")) return <EmptyState title="You can't open this page" />;
  const db = getDb();
  const purchasing = can(actor, "procurement.read");
  const [rows, onOrder, suppliers] = await Promise.all([reorderList(db, actor), onOrderByVariant(db), purchasing ? listSuppliers(db, actor) : Promise.resolve([])]);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  return (
    <>
      <PageHeader
        title="Reorder"
        description="SES-held items at or below their reorder point (set in each product's stock settings). Partner stock is the partner's to replenish. Suggested quantity = the usual order quantity, or enough to get back above the reorder point. Drafts go through the normal purchase approval."
        actions={can(actor, "procurement.write") && rows.length > 0 ? <ActionForm action={draftFromReorderAction} submitLabel="Draft purchase orders" submitClassName="btn btn-primary" /> : undefined}
      />
      <Card>
        {rows.length === 0 ? <EmptyState title="Nothing to reorder">Items appear here when available stock falls to their reorder point.</EmptyState> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Item</th><th className="text-right">Available</th><th className="text-right">Reorder at</th><th className="text-right">On order</th><th className="text-right">Suggested</th><th>Preferred supplier</th><th className="text-right">Est. cost</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.variantId}>
                    <td><Link href={`/ops/catalogue/${r.productId}`} className="font-medium text-teal-700 hover:underline">{r.name}</Link><span className="block font-mono text-xs text-slate-600">{r.sku}</span></td>
                    <td className="text-right tabular-nums">{r.ownAvailable}</td>
                    <td className="text-right tabular-nums">{r.reorderPoint}</td>
                    <td className="text-right tabular-nums">{onOrder.get(r.variantId) ?? 0}</td>
                    <td className="text-right font-semibold tabular-nums">{r.suggestedQty}</td>
                    <td className="text-sm">{r.preferredSupplierId ? supplierName.get(r.preferredSupplierId) ?? "—" : <span className="text-slate-500">not set</span>}{r.leadTimeDays !== null && <span className="block text-xs text-slate-600">{r.leadTimeDays} days lead time</span>}</td>
                    <td className="text-right tabular-nums">{r.costMinor === null ? "—" : <Money minor={r.costMinor * r.suggestedQty} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
