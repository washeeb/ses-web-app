import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { getQuote } from "@/server/modules/sales";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, PageHeader, StatusBadge } from "@/components/ui";
import { QuoteView } from "@/components/quote-view";
import { LiveRefresh } from "@/components/live-refresh";
import { DocumentsPanel } from "@/components/documents-panel";
import { sendQuoteAction, submitQuoteAction } from "../../actions";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const q = await getQuote(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError && (e.code === "not_found" || e.code === "forbidden")) notFound();
    throw e;
  });
  const canWrite = can(actor, "quotes.write", { departmentId: q.departmentId });
  return (
    <>
      <PageHeader
        title={`Quotation ${q.number}`}
        actions={
          <>
            <LiveRefresh topics={["quotes", "approvals", "orders"]} />
            {canWrite && q.status === "draft" && (
              <ActionForm action={submitQuoteAction} inline submitLabel="Submit">
                <input type="hidden" name="id" value={q.id} />
              </ActionForm>
            )}
            {canWrite && q.status === "approved" && (
              <ActionForm action={sendQuoteAction} inline submitLabel="Send to customer" submitClassName="btn btn-accent">
                <input type="hidden" name="id" value={q.id} />
              </ActionForm>
            )}
          </>
        }
      />
      {q.status === "pending_approval" && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Waiting for approval. {can(actor, "approvals.read") && <Link href="/ops/approvals" className="font-semibold underline">Open approvals</Link>}
        </p>
      )}
      {q.order && (
        <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          Accepted by the customer. Order <Link className="font-semibold underline" href={`/ops/orders/${q.order.id}`}>{q.order.number}</Link> ({q.order.status}).
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <QuoteView q={q} />
        </Card>
        <div className="min-w-0 space-y-6">
        <Card title="Approval history">
          {q.approvals.length === 0 ? (
            <p className="text-sm text-slate-500">No approval was required.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {q.approvals.map((a) => (
                <li key={a.id}>
                  <StatusBadge status={a.status} /> <span className="text-slate-600">{a.summary}</span>
                  <p className="text-xs text-slate-500">Raised <DateTime value={a.createdAt} />{a.decidedAt && <> · decided <DateTime value={a.decidedAt} /></>}</p>
                  {a.decisionNote && <p className="text-xs italic text-slate-600">“{a.decisionNote}”</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <DocumentsPanel actor={actor} entityType="quote" entityId={q.id} path={`/ops/quotes/${q.id}`} customerFacing />
        </div>
      </div>
    </>
  );
}
