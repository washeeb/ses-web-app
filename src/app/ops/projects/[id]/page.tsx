import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getProject, projectStaff } from "@/server/modules/projects";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, EmptyState, Field, PageHeader, StatusBadge } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { projectAction } from "../../services-actions";

export const metadata: Metadata = { title: "Project" };

const NEXT_TASK: Record<string, { status: string; label: string }> = {
  todo: { status: "in_progress", label: "Start" },
  in_progress: { status: "done", label: "Mark done" },
  done: { status: "in_progress", label: "Reopen" },
};

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const p = await getProject(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const write = can(actor, "projects.write") && !["completed", "cancelled"].includes(p.status);
  const staff = write ? await projectStaff(db) : [];
  const groups = [...p.milestones.map((m) => ({ m, tasks: p.tasks.filter((t) => t.t.milestoneId === m.id) })), { m: null, tasks: p.tasks.filter((t) => !t.t.milestoneId) }];
  const signer = (uid: string | null) => p.signerNames.find((s) => s.id === uid)?.name;
  const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;
  return (
    <>
      <Link href="/ops/projects" className="text-sm text-teal-700 hover:underline">← Projects</Link>
      <div className="mt-4">
        <PageHeader
          title={`${p.number}: ${p.name}`}
          description={<>
            {p.customerOrgId ? <Link href={`/ops/customers/${p.customerOrgId}`} className="text-teal-700 underline">{p.customerName}</Link> : "Internal project"} · managed by {p.managerName}
            {p.dueDate && <> · due <DateTime value={p.dueDate} dateOnly /></>}
          </>}
          actions={<><LiveRefresh topics={["projects"]} /><StatusBadge status={p.status} /></>}
        />
      </div>
      {p.description && <p className="mb-6 max-w-3xl whitespace-pre-line text-sm text-slate-700">{p.description}</p>}
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {p.milestones.length === 0 && p.tasks.length === 0 && <EmptyState title="No milestones yet">Add the stages the customer will sign off, then the tasks under each.</EmptyState>}
          {groups.map(({ m, tasks }) =>
            !m && tasks.length === 0 ? null : (
              <Card
                key={m?.id ?? "none"}
                title={m ? <>{m.name}{m.dueDate && <span className="ml-2 text-xs font-normal text-slate-600">due <DateTime value={m.dueDate} dateOnly /></span>}</> : "Other tasks"}
                actions={m ? <StatusBadge status={m.status} /> : undefined}
              >
                {tasks.length === 0 ? (
                  <p className="text-sm text-slate-500">No tasks.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {tasks.map(({ t, assigneeName }) => (
                      <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span>
                          <span className={t.status === "done" ? "text-slate-500 line-through" : ""}>{t.title}</span>
                          <span className="block text-xs text-slate-600">{assigneeName ?? "Unassigned"}{t.dueDate && <> · due <DateTime value={t.dueDate} dateOnly /></>}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <StatusBadge status={t.status} />
                          {write && (!m || m.status === "open") && (
                            <ActionForm action={projectAction} inline submitLabel={<>{NEXT_TASK[t.status]!.label}<span className="sr-only">: {t.title}</span></>} submitClassName="btn btn-ghost">
                              {hidden("projectId", p.id)}{hidden("op", "task_status")}{hidden("taskId", t.id)}{hidden("status", NEXT_TASK[t.status]!.status)}
                            </ActionForm>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {m && (
                  <div className="mt-4 border-t border-slate-100 pt-3 text-sm">
                    {m.status === "signed_off" && <p>Signed off by {signer(m.signedOffBy) ?? "the customer"} on <DateTime value={m.signedOffAt} dateOnly />{m.signoffNote && <> — “{m.signoffNote}”</>}</p>}
                    {m.status === "open" && m.signoffNote && <p className="mb-2 text-amber-800">Last sign-off was declined: “{m.signoffNote}”</p>}
                    {write && m.status === "open" && (
                      <ActionForm action={projectAction} submitLabel={p.customerOrgId ? "Ask the customer to sign off" : "Request sign-off"} submitClassName="btn btn-accent">
                        {hidden("projectId", p.id)}{hidden("op", "request_signoff")}{hidden("milestoneId", m.id)}
                      </ActionForm>
                    )}
                    {m.status === "awaiting_signoff" && (p.customerOrgId ? (
                      <p className="text-slate-600">Waiting for the customer&apos;s administrator to sign off in their portal.</p>
                    ) : (
                      can(actor, "projects.write") && m.signoffRequestedBy !== actor.userId ? (
                        <ActionForm action={projectAction} submitLabel="Record decision">
                          {hidden("projectId", p.id)}{hidden("op", "signoff")}{hidden("milestoneId", m.id)}
                          <Field label="Decision" htmlFor={`d-${m.id}`}>
                            <select id={`d-${m.id}`} name="decision" className="field"><option value="approve">Sign off</option><option value="reject">Send back</option></select>
                          </Field>
                          <Field label="Note" htmlFor={`n-${m.id}`}><input id={`n-${m.id}`} name="note" className="field" maxLength={500} /></Field>
                        </ActionForm>
                      ) : (
                        <p className="text-slate-600">Waiting for another project member to sign off.</p>
                      )
                    ))}
                  </div>
                )}
              </Card>
            ),
          )}
        </div>
        {write && (
          <div className="min-w-0 space-y-6">
            <Card title="Add milestone">
              <ActionForm action={projectAction} submitLabel="Add milestone" resetOnSuccess>
                {hidden("projectId", p.id)}{hidden("op", "milestone")}
                <Field label="Name" htmlFor="msName"><input id="msName" name="name" className="field" required minLength={2} maxLength={160} /></Field>
                <Field label="Due (optional)" htmlFor="msDue"><input id="msDue" name="dueDate" type="date" className="field" /></Field>
              </ActionForm>
            </Card>
            <Card title="Add task">
              <ActionForm action={projectAction} submitLabel="Add task" resetOnSuccess>
                {hidden("projectId", p.id)}{hidden("op", "task")}
                <Field label="Task" htmlFor="taskTitle"><input id="taskTitle" name="title" className="field" required minLength={2} maxLength={200} /></Field>
                <Field label="Milestone" htmlFor="taskMs">
                  <select id="taskMs" name="milestoneId" className="field" defaultValue="">
                    <option value="">None</option>
                    {p.milestones.filter((m) => m.status === "open").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </Field>
                <Field label="Assignee" htmlFor="taskWho">
                  <select id="taskWho" name="assigneeUserId" className="field" defaultValue="">
                    <option value="">Unassigned</option>
                    {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </Field>
                <Field label="Due (optional)" htmlFor="taskDue"><input id="taskDue" name="dueDate" type="date" className="field" /></Field>
              </ActionForm>
            </Card>
            <Card title="Project status">
              <ActionForm action={projectAction} submitLabel="Update status" submitClassName="btn btn-ghost">
                {hidden("projectId", p.id)}{hidden("op", "status")}
                <Field label="Status" htmlFor="pStatus" hint="Completing needs every milestone signed off.">
                  <select id="pStatus" name="status" className="field" defaultValue={p.status}>
                    {["planning", "active", "on_hold", "completed", "cancelled"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                </Field>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
