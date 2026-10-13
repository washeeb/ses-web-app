import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listTags } from "@/server/modules/taxonomy";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { tagAction } from "../../actions";

export const metadata: Metadata = { title: "Tags" };

export default async function TagsPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "catalogue.read")) return <EmptyState title="You can't open this page" />;
  const rows = await listTags(getDb());
  const write = can(actor, "catalogue.write");
  return (
    <>
      <PageHeader title="Tags" description="Tags are added on each product (comma-separated). Here you can rename or remove them everywhere at once." />
      <Card>
        {rows.length === 0 ? <EmptyState title="No tags yet">Add tags on a product&apos;s page.</EmptyState> : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Tag</th><th>Products</th>{write && <th><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    <td>
                      {write ? (
                        <ActionForm action={tagAction} inline submitLabel="Rename" submitClassName="btn btn-ghost px-2 py-1 text-xs">
                          <input type="hidden" name="id" value={t.id} />
                          <label className="sr-only" htmlFor={`tag-${t.id}`}>Name</label>
                          <input id={`tag-${t.id}`} name="name" className="field py-1" defaultValue={t.name} maxLength={40} required />
                        </ActionForm>
                      ) : t.name}
                    </td>
                    <td><Link href={`/store?tag=${t.slug}`} className="text-teal-700 hover:underline">{t.productCount}</Link></td>
                    {write && (
                      <td>
                        <ActionForm action={tagAction} inline submitLabel="Remove" submitClassName="btn btn-ghost px-2 py-1 text-xs text-red-700" confirm={`Remove the tag “${t.name}” from all products?`}>
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="op" value="delete" />
                        </ActionForm>
                      </td>
                    )}
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
