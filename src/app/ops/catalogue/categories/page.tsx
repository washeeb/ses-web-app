import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listCategoriesTree } from "@/server/modules/taxonomy";
import { mainImages } from "@/server/modules/media";
import { ActionForm } from "@/components/action-form";
import { CategoryFields } from "@/components/taxonomy-forms";
import { NoPicture, Picture } from "@/components/picture";
import { Badge, Card, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { categoryAction } from "../../actions";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "catalogue.read")) return <EmptyState title="You can't open this page" />;
  const db = getDb();
  const rows = await listCategoriesTree(db);
  const images = await mainImages(db, "category", rows.map((r) => r.id));
  const write = can(actor, "catalogue.write");
  return (
    <>
      <PageHeader title="Categories" description="Group products for the store menu and filters. Sub-categories go one level deep; a category's products include its sub-categories'." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          {rows.length === 0 ? <EmptyState title="No categories yet" /> : (
            <TableWrap>
              <table className="table">
                <thead><tr><th className="w-16"><span className="sr-only">Picture</span></th><th>Category</th><th>SKU code</th><th>Products</th><th>Shop</th></tr></thead>
                <tbody>
                  {rows.map((c) => {
                    const img = images.get(c.id);
                    return (
                      <tr key={c.id}>
                        <td>{img ? <Picture m={img} sizes="48px" fallbackWidth={320} className="h-12 w-12 rounded object-cover" alt="" /> : <NoPicture label={c.name} className="h-12 w-12 rounded" />}</td>
                        <td className={c.depth ? "pl-8" : ""}>
                          {c.depth ? <span aria-hidden="true" className="mr-1 text-slate-400">↳</span> : null}
                          <Link href={`/ops/catalogue/categories/${c.id}`} className="font-medium text-teal-700 hover:underline">{c.name}</Link>
                          {c.parentName && <span className="sr-only"> (inside {c.parentName})</span>}
                          <span className="block text-xs text-slate-600">/store?category={c.slug}</span>
                        </td>
                        <td className="font-mono text-xs">{c.skuCode || c.slug.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase().padEnd(3, "X")}</td>
                        <td>{c.productCount}</td>
                        <td>{c.active ? <Badge tone="green">shown</Badge> : <Badge>hidden</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        {write && (
          <Card title="New category">
            <ActionForm action={categoryAction} submitLabel="Create category">
              <CategoryFields c={null} parents={rows.filter((r) => r.depth === 0)} />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
