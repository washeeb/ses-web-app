import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { APPROVAL_TYPES, listApprovals } from "@/server/modules/approvals";
import { can } from "@/server/authz/policy";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, DateTime, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { decideApprovalAction } from "../actions";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor("operator");
  const show = (await searchParams).show === "all" ? "all" : "pending";
  const rows = await listApprovals(getDb(), actor, show);
  const link = (type: string, subjectId: string) => (type === "quote.approval" ? `/ops/quotes/${subjectId}` : null);
  return (
    <>
      <PageHeader
        title="Approvals"
        description="High-value quotations, deep discounts, sensitive price changes and privileged access need a second person. You cannot decide your own requests."
        actions={
          <>
            <LiveRefresh topics={["approvals"]} />
            <Link href={show === "all" ? "/ops/approvals" : "/ops/approvals?show=all"} className="btn btn-ghost">{show === "all" ? "Show pending only" : "Show history"}</Link>
          </>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title={show === "pending" ? "Nothing waiting for approval" : "No approval history"} />
      ) : (
        <div className="space-y-3">
          {rows.map(({ a, requesterName }) => {
            const type = APPROVAL_TYPES[a.type];
            const mayDecide = a.status === "pending" && type && can(actor, type.permission) && a.requestedBy !== actor.userId;
            const href = link(a.type, a.subjectId);
            return (
              <Card key={a.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="purple">{type?.label ?? a.type}</Badge>
                      <StatusBadge status={a.status} />
                    </div>
                    <p className="mt-2 font-medium">{href ? <Link href={href} className="hover:underline">{a.summary}</Link> : a.summary}</p>
                    <p className="text-xs text-slate-500">
                      Requested by {requesterName ?? "the system (partner feed)"} · <DateTime value={a.createdAt} />
                    </p>
                    {typeof (a.payload as { reason?: string }).reason === "string" && <p className="mt-1 text-sm text-slate-600">Reason: {(a.payload as { reason: string }).reason}</p>}
                    {a.decisionNote && <p className="mt-1 text-sm italic text-slate-600">Decision note: {a.decisionNote}</p>}
                  </div>
                  {mayDecide ? (
                    <ActionForm action={decideApprovalAction} className="flex w-full max-w-sm flex-col gap-2">
                      <input type="hidden" name="id" value={a.id} />
                      <label className="sr-only" htmlFor={`note-${a.id}`}>Decision note</label>
                      <input id={`note-${a.id}`} name="note" placeholder="Note (optional)" className="field" maxLength={500} />
                      <div className="flex gap-2">
                        <button name="decision" value="approve" className="btn btn-accent flex-1">Approve</button>
                        <button name="decision" value="reject" className="btn btn-danger flex-1">Reject</button>
                      </div>
                    </ActionForm>
                  ) : a.status === "pending" ? (
                    <p className="text-xs text-slate-500">{a.requestedBy === actor.userId ? "You raised this request." : "You are not authorised to decide this type."}</p>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
