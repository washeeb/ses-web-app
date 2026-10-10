import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getTicket, LEVEL_LABEL, supportStaff } from "@/server/modules/tickets";
import { COVERAGE_LABEL, PRIORITIES, type Coverage } from "@/server/modules/service-time";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, Field, PageHeader, StatusBadge } from "@/components/ui";
import { PriorityBadge, SlaDue, TicketThread } from "@/components/service-ui";
import { LiveRefresh } from "@/components/live-refresh";
import { ticketReplyAction, ticketUpdateAction } from "../../services-actions";

export const metadata: Metadata = { title: "Ticket" };

export default async function OpsTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const t = await getTicket(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const write = can(actor, "support.write");
  const open = ["new", "open", "pending_customer"].includes(t.status);
  const staff = write ? await supportStaff(db) : [];
  const finished = ["resolved", "closed"].includes(t.status);
  return (
    <>
      <Link href="/ops/support" className="text-sm text-teal-700 hover:underline">← Support</Link>
      <div className="mt-4">
        <PageHeader
          title={`${t.number}: ${t.subject}`}
          description={<>
            <Link href={`/ops/customers/${t.customerOrgId}`} className="text-teal-700 underline">{t.customerName}</Link> · raised by {t.requesterName} · <DateTime value={t.createdAt} />
          </>}
          actions={<><LiveRefresh topics={["tickets"]} /><PriorityBadge priority={t.priority} /><StatusBadge status={t.status} /></>}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <TicketThread ticket={t} staffOrgView />
          {write && t.status !== "closed" && (
            <Card title="Reply">
              <ActionForm action={ticketReplyAction} submitLabel="Send" resetOnSuccess>
                <input type="hidden" name="id" value={t.id} />
                <Field label="Message" htmlFor="body"><textarea id="body" name="body" rows={5} className="field" required minLength={2} maxLength={8000} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="internal" /> Internal note (not shown to the customer)</label>
              </ActionForm>
            </Card>
          )}
        </div>
        <div className="min-w-0 space-y-6">
          <Card title="Service level">
            <dl className="space-y-2 text-sm">
              <div><dt className="font-semibold">Coverage</dt><dd>{COVERAGE_LABEL[t.coverage as Coverage]}{t.contractId ? " (contract)" : " (standard)"}</dd></div>
              <div><dt className="font-semibold">First response by</dt><dd><SlaDue due={t.responseDueAt} breached={t.responseBreached} done={!!t.firstRespondedAt} /></dd></div>
              <div><dt className="font-semibold">Resolve by</dt><dd><SlaDue due={t.resolutionDueAt} breached={t.resolutionBreached} paused={!!t.pausedAt} done={finished} /></dd></div>
              <div><dt className="font-semibold">Line</dt><dd>{LEVEL_LABEL[t.level]}</dd></div>
              <div><dt className="font-semibold">Assignee</dt><dd>{t.assigneeName ?? "Unassigned"}</dd></div>
              <div><dt className="font-semibold">Category</dt><dd>{t.category}</dd></div>
              {t.asset && <div><dt className="font-semibold">Equipment</dt><dd><Link href={`/ops/assets/${t.asset.id}`} className="text-teal-700">{t.asset.tag}</Link> · {t.asset.name}</dd></div>}
            </dl>
          </Card>
          {write && t.status !== "closed" && (
            <Card title="Handle">
              <div className="space-y-5">
                <ActionForm action={ticketUpdateAction} submitLabel="Update status" submitClassName="btn btn-ghost">
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="op" value="status" />
                  <Field label="Status" htmlFor="status">
                    <select id="status" name="status" className="field" defaultValue={t.status === "new" ? "open" : t.status}>
                      <option value="open">Open</option>
                      <option value="pending_customer">Waiting on customer (pauses the clock)</option>
                      <option value="resolved">Resolved</option>
                      {t.status === "resolved" && <option value="closed">Closed</option>}
                    </select>
                  </Field>
                </ActionForm>
                {open && (
                  <ActionForm action={ticketUpdateAction} submitLabel="Assign" submitClassName="btn btn-ghost">
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="op" value="assign" />
                    <Field label="Assignee" htmlFor="assigneeUserId">
                      <select id="assigneeUserId" name="assigneeUserId" className="field" defaultValue={t.assigneeUserId ?? ""}>
                        <option value="">Unassigned</option>
                        {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </Field>
                  </ActionForm>
                )}
                {open && (
                  <ActionForm action={ticketUpdateAction} submitLabel="Change priority" submitClassName="btn btn-ghost">
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="op" value="priority" />
                    <Field label="Priority" htmlFor="priority" hint="Targets are recalculated from when the ticket was raised.">
                      <select id="priority" name="priority" className="field" defaultValue={t.priority}>
                        {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </Field>
                  </ActionForm>
                )}
                {open && t.level < 3 && (
                  <ActionForm action={ticketUpdateAction} submitLabel={`Escalate to ${LEVEL_LABEL[t.level + 1]}`} submitClassName="btn btn-danger">
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="op" value="escalate" />
                    <Field label="Reason for escalation" htmlFor="reason"><input id="reason" name="reason" className="field" required minLength={5} maxLength={300} /></Field>
                  </ActionForm>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
