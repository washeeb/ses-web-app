import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listProjects, projectStaff } from "@/server/modules/projects";
import { listSubscriptionCustomers } from "@/server/modules/subscriptions";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, EmptyState, Field, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { createProjectAction } from "../services-actions";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "projects.read")) return <EmptyState title="You can't open this page">Projects need project access.</EmptyState>;
  const mine = (await searchParams).mine === "1";
  const db = getDb();
  const write = can(actor, "projects.write");
  const [rows, customers, staff] = await Promise.all([listProjects(db, actor, { mine }), write ? listSubscriptionCustomers(db) : [], write ? projectStaff(db) : []]);
  return (
    <>
      <PageHeader
        title="Projects"
        description="Delivery projects: milestones, tasks and customer sign-off."
        actions={<><LiveRefresh topics={["projects"]} /><Link href={mine ? "/ops/projects" : "/ops/projects?mine=1"} className="btn btn-ghost">{mine ? "All projects" : "Projects I manage"}</Link></>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          {rows.length === 0 ? (
            <EmptyState title="No projects yet" />
          ) : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Project</th><th>Customer</th><th>Status</th><th>Progress</th><th>Due</th><th>Manager</th></tr></thead>
                <tbody>
                  {rows.map(({ p, customerName, managerName, tasksDone, tasksTotal }) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/ops/projects/${p.id}`} className="font-medium text-teal-700 hover:underline">{p.number}</Link>
                        <span className="block max-w-xs truncate text-xs text-slate-600">{p.name}</span>
                      </td>
                      <td>{customerName ?? <span className="text-slate-500">Internal</span>}</td>
                      <td><StatusBadge status={p.status} /></td>
                      <td className="text-xs">{tasksTotal ? `${tasksDone}/${tasksTotal} tasks` : "—"}</td>
                      <td><DateTime value={p.dueDate} dateOnly /></td>
                      <td className="text-xs">{managerName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        {write && (
          <Card title="New project">
            <ActionForm action={createProjectAction} submitLabel="Create project">
              <Field label="Name" htmlFor="name"><input id="name" name="name" className="field" required minLength={3} maxLength={160} /></Field>
              <Field label="Customer" htmlFor="customerOrgId">
                <select id="customerOrgId" name="customerOrgId" className="field" defaultValue="">
                  <option value="">Internal project</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Project manager" htmlFor="managerUserId">
                <select id="managerUserId" name="managerUserId" className="field" defaultValue={actor.userId}>
                  {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start" htmlFor="startDate"><input id="startDate" name="startDate" type="date" className="field" /></Field>
                <Field label="Due" htmlFor="dueDate"><input id="dueDate" name="dueDate" type="date" className="field" /></Field>
              </div>
              <Field label="Description (optional)" htmlFor="description"><textarea id="description" name="description" rows={3} className="field" maxLength={4000} /></Field>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
