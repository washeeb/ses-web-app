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
import { aiSuggestAction, ticketReplyAction, ticketUpdateAction } from "../../services-actions";
import { aiAvailable, latestTicketSuggestion } from "@/server/modules/ai";
import { searchArticles } from "@/server/modules/knowledge";

export const metadata: Metadata = { title: "Ticket" };

export default async function OpsTicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ draft?: string }> }) {
  const { id } = await params;
  const { draft } = await searchParams;
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
  const aiOn = write && (await aiAvailable(db, actor));
  const [suggestion, related] = await Promise.all([aiOn ? latestTicketSuggestion(db, actor, t.id) : null, searchArticles(db, actor, t.subject, 4)]);
  const draftText = draft === "ai" && suggestion ? suggestion.reply : "";
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
            <div id="reply" />
          )}
          {write && t.status !== "closed" && (
            <Card title="Reply">
              <ActionForm action={ticketReplyAction} submitLabel="Send" resetOnSuccess>
                <input type="hidden" name="id" value={t.id} />
                {draftText && <p className="rounded bg-violet-50 px-3 py-2 text-xs text-violet-900">The AI draft is in the box below. Read and edit it before sending — you are responsible for what is sent.</p>}
                <Field label="Message" htmlFor="body"><textarea id="body" name="body" rows={draftText ? 9 : 5} className="field" required minLength={2} maxLength={8000} defaultValue={draftText} key={draftText ? "draft" : "empty"} /></Field>
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
          {aiOn && t.status !== "closed" && (
            <Card title="AI assistant">
              {suggestion ? (
                <div className="mb-3 space-y-1 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">AI suggestion — not applied</p>
                  <p>Category: <strong>{suggestion.category}</strong> · priority: <strong>{suggestion.priority}</strong></p>
                  {suggestion.reasoning && <p className="text-slate-600">{suggestion.reasoning}</p>}
                  <p className="text-xs text-slate-500">{suggestion.model}, <DateTime value={suggestion.at} /></p>
                  {draft !== "ai" && <Link href={`/ops/support/${t.id}?draft=ai#reply`} className="text-teal-700 underline">Put the suggested reply in the reply box</Link>}
                </div>
              ) : (
                <p className="mb-3 text-sm text-slate-600">Suggests a category, priority and first reply from the customer&apos;s messages and help articles. Internal notes and contact details are not sent.</p>
              )}
              <ActionForm action={aiSuggestAction} submitLabel={suggestion ? "Suggest again" : "Suggest a reply"} submitClassName="btn btn-ghost w-full">
                <input type="hidden" name="id" value={t.id} />
              </ActionForm>
            </Card>
          )}
          {related.length > 0 && (
            <Card title="Related help articles">
              <ul className="space-y-1 text-sm">
                {related.map((a) => (
                  <li key={a.id}><Link href={`/help/${a.slug}`} className="text-teal-700 underline">{a.title}</Link>{a.audience === "internal" && <span className="ml-1 text-xs text-amber-800">(internal)</span>}</li>
                ))}
              </ul>
            </Card>
          )}
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
