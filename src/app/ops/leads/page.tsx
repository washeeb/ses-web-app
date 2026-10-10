import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { LEAD_STATUSES, listLeads } from "@/server/modules/sales";
import { can } from "@/server/authz/policy";
import { listDepartments } from "@/server/modules/admin";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, DateTime, EmptyState, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { convertLeadAction, leadStatusAction } from "../actions";

export default async function LeadsPage() {
  const actor = await requireActor("operator");
  const db = getDb();
  const [leads, depts] = await Promise.all([listLeads(db, actor), listDepartments(db)]);
  const canWrite = can(actor, "leads.write");
  return (
    <>
      <PageHeader title="Leads" description="Website enquiries and other opportunities. Qualify a lead, convert it to a customer and prepare a quotation." actions={<LiveRefresh topics={["leads"]} />} />
      <Card>
        {leads.length === 0 ? (
          <EmptyState title="No leads yet">New website enquiries appear here automatically.</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Contact</th>
                  <th>Interest</th>
                  <th>Department</th>
                  <th>Status</th>
                  {canWrite && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <p className="font-medium">{l.number}</p>
                      <p className="text-xs text-slate-500"><DateTime value={l.createdAt} /></p>
                      {l.isDemo && <Badge tone="amber">Demo</Badge>}
                    </td>
                    <td>
                      <p>{l.contactName}</p>
                      <p className="text-xs text-slate-500">{l.companyName ?? "—"} · <a className="hover:underline" href={`mailto:${l.email}`}>{l.email}</a></p>
                    </td>
                    <td className="max-w-xs">
                      <p>{l.serviceInterest ?? "—"}</p>
                      {l.message && <p className="line-clamp-2 text-xs text-slate-500">{l.message}</p>}
                    </td>
                    <td className="text-xs">{depts.find((d) => d.id === l.departmentId)?.name ?? "Shared"}</td>
                    <td><StatusBadge status={l.status} /></td>
                    {canWrite && (
                      <td className="space-y-2">
                        <ActionForm action={leadStatusAction} inline submitLabel="Set" submitClassName="btn btn-ghost">
                          <input type="hidden" name="id" value={l.id} />
                          <label className="sr-only" htmlFor={`st-${l.id}`}>Status for {l.number}</label>
                          <select id={`st-${l.id}`} name="status" defaultValue={l.status} className="field w-auto py-1">
                            {LEAD_STATUSES.map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </ActionForm>
                        {can(actor, "quotes.write") && (
                          <ActionForm action={convertLeadAction} inline submitLabel={l.customerOrgId ? "New quotation" : "Convert & quote"} submitClassName="btn btn-accent">
                            <input type="hidden" name="id" value={l.id} />
                          </ActionForm>
                        )}
                      </td>
                    )}
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
