import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { itemOptions, listLocations, listTransfers } from "@/server/modules/inventory";
import { ActionForm } from "@/components/action-form";
import { ItemDatalist, ItemRows, LocationSelect } from "@/components/stock-ui";
import { Card, DateTime, EmptyState, Field, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { createTransferAction } from "../../inventory-actions";

export const metadata: Metadata = { title: "Stock transfers" };

export default async function TransfersPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "inventory.read")) return <EmptyState title="You can't open this page" />;
  const db = getDb();
  const [rows, locations, items] = await Promise.all([listTransfers(db, actor), listLocations(db), itemOptions(db)]);
  const write = can(actor, "inventory.adjust");
  const active = locations.filter((l) => l.active);
  return (
    <>
      <PageHeader title="Stock transfers" description="Move stock between the shop, store rooms and vehicles. Stock leaves the source when the transfer is sent and arrives when it is received." />
      <div className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
        <Card title="Transfers">
          {rows.length === 0 ? <EmptyState title="No transfers yet" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Number</th><th>From → to</th><th className="text-right">Units</th><th>Status</th><th>Created</th></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td><Link href={`/ops/inventory/transfers/${t.id}`} className="font-medium text-teal-700 hover:underline">{t.number}</Link></td>
                      <td className="text-sm">{t.fromName} → {t.toName}</td>
                      <td className="text-right tabular-nums">{t.units}</td>
                      <td><StatusBadge status={t.status} /></td>
                      <td className="text-xs"><DateTime value={t.createdAt} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        {write && (
          <Card title="New transfer">
            {active.length < 2 ? (
              <p className="text-sm text-slate-600">Add a second location first, in <Link href="/ops/inventory/locations" className="text-teal-700 underline">Locations</Link>.</p>
            ) : (
              <ActionForm action={createTransferAction} submitLabel="Create transfer">
                <ItemDatalist items={items} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <LocationSelect id="t-from" name="fromLocationId" label="From" locations={locations} />
                  <LocationSelect id="t-to" name="toLocationId" label="To" locations={locations} defaultValue={active.find((l) => !l.isDefault)?.id} />
                </div>
                <ItemRows count={8} />
                <Field label="Note" htmlFor="t-note"><input id="t-note" name="note" className="field" maxLength={300} /></Field>
              </ActionForm>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
