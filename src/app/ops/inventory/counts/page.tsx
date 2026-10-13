import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listCounts, listLocations } from "@/server/modules/inventory";
import { listCategoriesTree } from "@/server/modules/taxonomy";
import { ActionForm } from "@/components/action-form";
import { LocationSelect } from "@/components/stock-ui";
import { Card, DateTime, EmptyState, Field, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { startCountAction } from "../../inventory-actions";

export const metadata: Metadata = { title: "Stocktakes" };

export default async function CountsPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "inventory.read")) return <EmptyState title="You can't open this page" />;
  const db = getDb();
  const [rows, locations, cats] = await Promise.all([listCounts(db, actor), listLocations(db), listCategoriesTree(db)]);
  return (
    <>
      <PageHeader title="Stocktakes" description="Count a whole location, or one category at a time (cycle counting). Each item's system quantity is noted when you count it, so sales during the count are handled correctly." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card title="Stocktakes">
          {rows.length === 0 ? <EmptyState title="No stocktakes yet" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Number</th><th>Location</th><th>Status</th><th className="text-right">Difference (at cost)</th><th>Started</th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td><Link href={`/ops/inventory/counts/${c.id}`} className="font-medium text-teal-700 hover:underline">{c.number}</Link></td>
                      <td>{c.locationName}</td>
                      <td><StatusBadge status={c.status} /></td>
                      <td className={`text-right tabular-nums ${(c.varianceValueMinor ?? 0) < 0 ? "text-red-700" : ""}`}>{c.varianceValueMinor === null ? "—" : <Money minor={c.varianceValueMinor} />}</td>
                      <td className="text-xs"><DateTime value={c.createdAt} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        {can(actor, "inventory.adjust") && (
          <Card title="Start a stocktake">
            <ActionForm action={startCountAction} submitLabel="Start">
              <LocationSelect id="sc-loc" label="Location" locations={locations} />
              <Field label="Only this category" htmlFor="sc-cat" hint="Leave as all to count everything stocked here.">
                <select id="sc-cat" name="categoryId" className="field" defaultValue="">
                  <option value="">All items stocked here</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.depth ? "— " : ""}{c.name}</option>)}
                </select>
              </Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="blind" defaultChecked /> Blind count (counters don&apos;t see expected quantities)</label>
              <Field label="Note" htmlFor="sc-note"><input id="sc-note" name="note" className="field" maxLength={300} placeholder="e.g. Month-end count" /></Field>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
