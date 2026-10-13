import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listCategoriesTree } from "@/server/modules/taxonomy";
import { listMedia } from "@/server/modules/media";
import { ActionForm } from "@/components/action-form";
import { CategoryFields } from "@/components/taxonomy-forms";
import { ImageManager } from "@/components/image-manager";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { categoryAction, imageAction, uploadImageAction } from "../../../actions";

export const metadata: Metadata = { title: "Category" };

export default async function CategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  if (!can(actor, "catalogue.read")) return <EmptyState title="You can't open this page" />;
  const db = getDb();
  const all = await listCategoriesTree(db);
  const c = all.find((x) => x.id === id);
  if (!c) notFound();
  const images = await listMedia(db, "category", [id]);
  const write = can(actor, "catalogue.write");
  return (
    <>
      <Link href="/ops/catalogue/categories" className="text-sm text-teal-700 hover:underline">← Categories</Link>
      <div className="mt-4">
        <PageHeader
          title={c.name}
          description={<>{c.productCount} product{c.productCount === 1 ? "" : "s"}{c.parentName ? ` · inside ${c.parentName}` : ""} · <Link className="text-teal-700 underline" href={`/store?category=${c.slug}`}>View in the store</Link></>}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Details">
          {write ? (
            <ActionForm action={categoryAction} submitLabel="Save category">
              <CategoryFields c={c} parents={all.filter((r) => r.depth === 0)} />
            </ActionForm>
          ) : (
            <p className="text-sm text-slate-700">{c.description || "No description."}</p>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Picture">
            <p className="mb-3 text-sm text-slate-600">Shown on the store&apos;s category tiles. A wide picture (about 3:2) works best.</p>
            <ImageManager images={images} ownerType="category" ownerId={c.id} defaultAlt={c.name} canWrite={write} uploadAction={uploadImageAction} imageAction={imageAction} single />
          </Card>
          {write && (
            <Card title="Delete">
              <p className="mb-3 text-sm text-slate-600">Only empty categories can be deleted. To stop showing one, untick “Show in the store” instead.</p>
              <ActionForm action={categoryAction} submitLabel="Delete category" submitClassName="btn btn-ghost text-red-700" confirm={`Delete ${c.name}?`}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="op" value="delete" />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
