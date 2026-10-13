import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listBrands } from "@/server/modules/taxonomy";
import { listMedia } from "@/server/modules/media";
import { ActionForm } from "@/components/action-form";
import { BrandFields } from "@/components/taxonomy-forms";
import { ImageManager } from "@/components/image-manager";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { brandAction, imageAction, uploadImageAction } from "../../../actions";

export const metadata: Metadata = { title: "Brand" };

export default async function BrandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  if (!can(actor, "catalogue.read")) return <EmptyState title="You can't open this page" />;
  const db = getDb();
  const b = (await listBrands(db)).find((x) => x.id === id);
  if (!b) notFound();
  const logo = await listMedia(db, "brand", [id]);
  const write = can(actor, "catalogue.write");
  return (
    <>
      <Link href="/ops/catalogue/brands" className="text-sm text-teal-700 hover:underline">← Brands</Link>
      <div className="mt-4">
        <PageHeader title={b.name} description={<>{b.productCount} product{b.productCount === 1 ? "" : "s"} · <Link className="text-teal-700 underline" href={`/store?brand=${b.slug}`}>View in the store</Link></>} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Details">
          {write ? (
            <ActionForm action={brandAction} submitLabel="Save brand">
              <BrandFields b={b} />
            </ActionForm>
          ) : (
            <p className="text-sm text-slate-700">{b.description || "No description."}</p>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Logo">
            <p className="mb-3 text-sm text-slate-600">A PNG or WebP with a transparent background looks best.</p>
            <ImageManager images={logo} ownerType="brand" ownerId={b.id} defaultAlt={`${b.name} logo`} canWrite={write} uploadAction={uploadImageAction} imageAction={imageAction} single />
          </Card>
          {write && (
            <Card title="Delete">
              <p className="mb-3 text-sm text-slate-600">Only brands without products can be deleted. To stop showing one, untick “Show in the store”.</p>
              <ActionForm action={brandAction} submitLabel="Delete brand" submitClassName="btn btn-ghost text-red-700" confirm={`Delete ${b.name}?`}>
                <input type="hidden" name="id" value={b.id} />
                <input type="hidden" name="op" value="delete" />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
