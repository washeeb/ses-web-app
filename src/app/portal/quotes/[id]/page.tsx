import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { getQuote } from "@/server/modules/sales";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { ActionForm } from "@/components/action-form";
import { Card } from "@/components/ui";
import { QuoteView } from "@/components/quote-view";
import { respondToQuote } from "../../actions";

export default async function PortalQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("customer");
  const q = await getQuote(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const canAccept = q.status === "sent" && can(actor, "customer.quotes.accept", { organizationId: q.customerOrgId });
  return (
    <div className="min-w-0 space-y-6">
      <Link href="/portal" className="text-sm text-teal-700 hover:underline">← Back to your account</Link>
      <Card>
        <QuoteView q={q} />
      </Card>
      {q.order && (
        <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          You accepted this quotation. <Link href={`/portal/orders/${q.order.id}`} className="font-semibold underline">View order {q.order.number}</Link>.
        </p>
      )}
      {canAccept && (
        <Card title="Your decision">
          <ActionForm action={respondToQuote} className="space-y-3">
            <input type="hidden" name="id" value={q.id} />
            <p className="text-sm text-slate-600">Accepting creates an order and reserves stock while SES confirms it. Physical items can only be accepted while confirmed stock is available.</p>
            <div className="flex flex-wrap gap-2">
              <button name="decision" value="accept" className="btn btn-accent">Accept quotation</button>
              <button name="decision" value="decline" className="btn btn-ghost">Decline</button>
            </div>
          </ActionForm>
        </Card>
      )}
      {q.status === "sent" && !canAccept && <p className="text-sm text-slate-600">Only your organisation&apos;s administrator can accept this quotation.</p>}
    </div>
  );
}
