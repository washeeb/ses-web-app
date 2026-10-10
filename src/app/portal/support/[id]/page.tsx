import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getTicket } from "@/server/modules/tickets";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, Field, PageHeader, StatusBadge } from "@/components/ui";
import { PriorityBadge, TicketThread } from "@/components/service-ui";
import { LiveRefresh } from "@/components/live-refresh";
import { customerReplyAction } from "../../services-actions";

export const metadata: Metadata = { title: "Ticket" };

export default async function PortalTicket({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ raised?: string }> }) {
  const { id } = await params;
  const { raised } = await searchParams;
  const actor = await requireActor("customer");
  const t = await getTicket(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const canWrite = can(actor, "customer.tickets.write", { organizationId: t.customerOrgId });
  return (
    <>
      <Link href="/portal/support" className="text-sm text-teal-700 hover:underline">← Support</Link>
      <div className="mt-4">
        <PageHeader
          title={`${t.number}: ${t.subject}`}
          description={<>Raised by {t.requesterName} · <DateTime value={t.createdAt} />{t.asset && <> · {t.asset.tag} {t.asset.name}</>}</>}
          actions={<><LiveRefresh topics={["tickets"]} /><PriorityBadge priority={t.priority} /><StatusBadge status={t.status} /></>}
        />
      </div>
      {raised && (
        <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          Thank you — ticket {t.number} has been received. We aim to respond by <DateTime value={t.responseDueAt} />.
        </p>
      )}
      {!t.firstRespondedAt && !raised && ["new", "open"].includes(t.status) && (
        <p className="mb-4 text-sm text-slate-600">We aim to respond by <DateTime value={t.responseDueAt} />.</p>
      )}
      {t.status === "pending_customer" && <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">We are waiting for your reply.</p>}
      {t.status === "resolved" && <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-900">We believe this is fixed. If not, reply below and the ticket reopens.</p>}
      <div className="max-w-3xl space-y-6">
        <TicketThread ticket={t} staffOrgView={false} />
        {t.status === "closed" ? (
          <p className="text-sm text-slate-600">This ticket is closed. <Link href="/portal/support/new" className="text-teal-700">Report a new problem</Link> and mention {t.number} if it is related.</p>
        ) : canWrite ? (
          <Card title="Reply">
            <ActionForm action={customerReplyAction} submitLabel="Send" resetOnSuccess>
              <input type="hidden" name="id" value={t.id} />
              <Field label="Message" htmlFor="body"><textarea id="body" name="body" rows={4} className="field" required minLength={2} maxLength={8000} /></Field>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
