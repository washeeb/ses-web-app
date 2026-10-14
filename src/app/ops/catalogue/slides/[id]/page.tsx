import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { getSlide, slideStatus } from "@/server/modules/slides";
import { listMedia } from "@/server/modules/media";
import { ActionForm } from "@/components/action-form";
import { SlideFields } from "@/components/taxonomy-forms";
import { ImageManager } from "@/components/image-manager";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { imageAction, slideAction, uploadImageAction } from "../../../actions";

export const metadata: Metadata = { title: "Slide" };

const STATUS = { live: "Showing on the home page now.", scheduled: "Scheduled: not showing yet.", ended: "Ended: no longer showing.", hidden: "Hidden from the home page." };

export default async function SlidePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  if (!can(actor, "catalogue.read")) return <EmptyState title="You can't open this page" />;
  const db = getDb();
  const s = await getSlide(db, id);
  if (!s) notFound();
  const pics = await listMedia(db, "slide", [id]);
  const write = can(actor, "catalogue.write");
  return (
    <>
      <Link href="/ops/catalogue/slides" className="text-sm text-teal-700 hover:underline">← Home page slides</Link>
      <div className="mt-4">
        <PageHeader title={s.headline} description={<>{STATUS[slideStatus(s)]} <Link href="/" className="text-teal-700 underline">View the home page</Link></>} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Wording and timing">
          {write ? (
            <ActionForm action={slideAction} submitLabel="Save slide">
              <SlideFields s={s} />
            </ActionForm>
          ) : (
            <p className="text-sm text-slate-700">{s.body || "No text."}</p>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Picture">
            <p className="mb-3 text-sm text-slate-600">Shown beside the text (above it on phones). Use a landscape picture about 3:2, at least 1600 pixels wide. Keep words out of the picture: the headline is already on the slide.</p>
            <ImageManager images={pics} ownerType="slide" ownerId={s.id} defaultAlt={s.headline} canWrite={write} uploadAction={uploadImageAction} imageAction={imageAction} single />
          </Card>
          {write && (
            <Card title="Delete">
              <p className="mb-3 text-sm text-slate-600">To take a slide down for a while, untick “Show on the home page” instead.</p>
              <ActionForm action={slideAction} submitLabel="Delete slide" submitClassName="btn btn-ghost text-red-700" confirm="Delete this slide and its picture?">
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="op" value="delete" />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
