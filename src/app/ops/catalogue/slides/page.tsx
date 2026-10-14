import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listSlides, slideStatus } from "@/server/modules/slides";
import { mainImages } from "@/server/modules/media";
import { ActionForm } from "@/components/action-form";
import { SlideFields } from "@/components/taxonomy-forms";
import { NoPicture, Picture } from "@/components/picture";
import { Badge, Card, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { slideAction } from "../../actions";

export const metadata: Metadata = { title: "Home page slides" };

const STATUS = { live: ["green", "on the home page"], scheduled: ["amber", "scheduled"], ended: ["gray", "ended"], hidden: ["gray", "hidden"] } as const;

export default async function SlidesPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "catalogue.read")) return <EmptyState title="You can't open this page" />;
  const db = getDb();
  const rows = await listSlides(db);
  const pics = await mainImages(db, "slide", rows.map((r) => r.id));
  const write = can(actor, "catalogue.write");
  const nextOrder = rows.length ? Math.max(...rows.map((r) => r.sortOrder)) + 10 : 0;
  return (
    <>
      <PageHeader
        title="Home page slides"
        description={<>The slider at the top of the <Link href="/" className="text-teal-700 underline">home page</Link>. Slides change every 7 seconds; visitors can pause them, and they stay still for people who turn off animations. With no live slides, the standard welcome shows instead.</>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <Card>
          {rows.length === 0 ? (
            <EmptyState title="No slides yet">Create one, then add its picture.</EmptyState>
          ) : (
            <TableWrap label="Slides">
              <table className="table">
                <thead><tr><th className="w-28"><span className="sr-only">Picture</span></th><th>Slide</th><th>Status</th>{write && <th><span className="sr-only">Order</span></th>}</tr></thead>
                <tbody>
                  {rows.map((s, i) => {
                    const pic = pics.get(s.id);
                    const [tone, label] = STATUS[slideStatus(s)];
                    return (
                      <tr key={s.id}>
                        <td>{pic ? <Picture m={pic} sizes="96px" fallbackWidth={320} className="aspect-[3/2] w-24 rounded object-cover" alt="" /> : <NoPicture label={s.headline} className="aspect-[3/2] w-24 rounded" />}</td>
                        <td>
                          <Link href={`/ops/catalogue/slides/${s.id}`} className="font-medium text-teal-700 hover:underline">{s.headline}</Link>
                          {(s.startsOn || s.endsOn) && <span className="block text-xs text-slate-600">{s.startsOn ? `from ${s.startsOn}` : ""}{s.startsOn && s.endsOn ? " " : ""}{s.endsOn ? `until ${s.endsOn}` : ""}</span>}
                          {!pic && <span className="block text-xs text-amber-800">No picture yet</span>}
                        </td>
                        <td><Badge tone={tone}>{label}</Badge></td>
                        {write && (
                          <td>
                            <div className="flex gap-1">
                              {(["up", "down"] as const).filter((op) => (op === "up" ? i > 0 : i < rows.length - 1)).map((op) => (
                                <ActionForm key={op} action={slideAction} inline submitClassName="btn btn-ghost px-2 py-1 text-sm" submitLabel={<><span aria-hidden="true">{op === "up" ? "↑" : "↓"}</span><span className="sr-only">Move “{s.headline}” {op}</span></>}>
                                  <input type="hidden" name="id" value={s.id} />
                                  <input type="hidden" name="op" value={op} />
                                </ActionForm>
                              ))}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        {write && (
          <Card title="New slide">
            <ActionForm action={slideAction} submitLabel="Create slide">
              <SlideFields s={null} nextOrder={nextOrder} />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
