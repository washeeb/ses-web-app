import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getProject } from "@/server/modules/projects";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, Field, PageHeader, StatusBadge } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { signoffAction } from "../../services-actions";

export const metadata: Metadata = { title: "Project" };

export default async function PortalProject({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("customer");
  const p = await getProject(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const canSign = can(actor, "customer.projects.signoff", { organizationId: p.customerOrgId });
  return (
    <>
      <Link href="/portal/projects" className="text-sm text-teal-700 hover:underline">← Projects</Link>
      <div className="mt-4">
        <PageHeader
          title={p.name}
          description={<>{p.number} · project manager {p.managerName}{p.dueDate && <> · due <DateTime value={p.dueDate} dateOnly /></>}</>}
          actions={<><LiveRefresh topics={["projects"]} /><StatusBadge status={p.status} /></>}
        />
      </div>
      {p.description && <p className="mb-6 max-w-3xl whitespace-pre-line text-sm text-slate-700">{p.description}</p>}
      <div className="max-w-3xl space-y-6">
        {p.milestones.map((m) => {
          const tasks = p.tasks.filter((t) => t.t.milestoneId === m.id);
          const done = tasks.filter((t) => t.t.status === "done").length;
          return (
            <Card key={m.id} title={m.name} actions={<StatusBadge status={m.status} />}>
              <p className="text-sm text-slate-600">
                {tasks.length ? `${done} of ${tasks.length} tasks done` : "No tasks listed"}
                {m.dueDate && <> · due <DateTime value={m.dueDate} dateOnly /></>}
              </p>
              {tasks.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-sm text-slate-700">
                  {tasks.map(({ t }) => <li key={t.id}>{t.title} — {t.status.replace("_", " ")}</li>)}
                </ul>
              )}
              {m.status === "signed_off" && <p className="mt-3 text-sm">Signed off <DateTime value={m.signedOffAt} dateOnly />{m.signoffNote && <> — “{m.signoffNote}”</>}</p>}
              {m.status === "awaiting_signoff" && (canSign ? (
                <div className="mt-4 rounded-lg bg-slate-50 p-4">
                  <p className="mb-3 text-sm font-medium">This milestone is ready for your sign-off.</p>
                  <ActionForm action={signoffAction} submitLabel="Submit decision">
                    <input type="hidden" name="milestoneId" value={m.id} />
                    <input type="hidden" name="projectId" value={p.id} />
                    <fieldset>
                      <legend className="field-label">Decision</legend>
                      <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="radio" name="decision" value="approve" defaultChecked /> Sign off — accepted</label>
                      <label className="inline-flex items-center gap-2 text-sm"><input type="radio" name="decision" value="reject" /> Not yet — needs more work</label>
                    </fieldset>
                    <Field label="Comments (required if not accepted)" htmlFor={`note-${m.id}`}><textarea id={`note-${m.id}`} name="note" rows={2} className="field" maxLength={500} /></Field>
                  </ActionForm>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-600">Awaiting sign-off by your organisation&apos;s administrator.</p>
              ))}
            </Card>
          );
        })}
        {p.milestones.length === 0 && <p className="text-sm text-slate-600">The project plan will appear here once milestones are set.</p>}
      </div>
    </>
  );
}
