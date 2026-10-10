import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { requireActor } from "@/server/web/session";
import { listAudit } from "@/server/modules/audit";
import { Card, DateTime, PageHeader, TableWrap } from "@/components/ui";

export default async function AuditPage() {
  const actor = await requireActor("operator");
  const db = getDb();
  const rows = await listAudit(db, actor, 300);
  const people = new Map((await db.select({ id: users.id, email: users.email }).from(users)).map((u) => [u.id, u.email]));
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sign-ins, privileged actions and every state change (latest 300)." />
      <Card>
        <TableWrap>
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs"><DateTime value={r.at} /></td>
                  <td className="text-xs">{r.actorUserId ? people.get(r.actorUserId) ?? r.actorUserId : "system"}{r.ip && <p className="text-slate-400">{r.ip}</p>}</td>
                  <td className="font-mono text-xs">{r.action}</td>
                  <td className="text-xs">{r.targetType}{r.targetId && <p className="font-mono text-[10px] text-slate-400">{r.targetId}</p>}</td>
                  <td className="max-w-md">
                    {Object.keys(r.data as object).length > 0 && (
                      <details>
                        <summary className="cursor-pointer text-xs text-teal-700">view</summary>
                        <pre className="mt-1 whitespace-pre-wrap break-all text-[11px] text-slate-600">{JSON.stringify(r.data, null, 1)}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
