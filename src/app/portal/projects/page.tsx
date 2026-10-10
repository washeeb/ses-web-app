import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { listProjects } from "@/server/modules/projects";
import { Card, DateTime, EmptyState, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Projects" };

export default async function PortalProjects() {
  const actor = await requireActor("customer");
  const rows = await listProjects(getDb(), actor);
  return (
    <>
      <PageHeader title="Projects" description="Work SES is delivering for you, with milestones for you to sign off." actions={<LiveRefresh topics={["projects"]} />} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No projects" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Project</th><th>Status</th><th>Progress</th><th>Due</th></tr></thead>
              <tbody>
                {rows.map(({ p, tasksDone, tasksTotal }) => (
                  <tr key={p.id}>
                    <td><Link href={`/portal/projects/${p.id}`} className="font-medium text-teal-700 hover:underline">{p.name}</Link><span className="block text-xs text-slate-600">{p.number}</span></td>
                    <td><StatusBadge status={p.status} /></td>
                    <td className="text-xs">{tasksTotal ? `${Math.round((tasksDone / tasksTotal) * 100)}% of tasks done` : "—"}</td>
                    <td><DateTime value={p.dueDate} dateOnly /></td>
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
