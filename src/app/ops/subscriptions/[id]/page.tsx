import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getSubscription } from "@/server/modules/subscriptions";
import { getSettings } from "@/server/modules/settings";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, EmptyState, Field, Money, PageHeader, StatusBadge } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { subscriptionAction } from "../../services-actions";

export const metadata: Metadata = { title: "Subscription" };

export default async function SubscriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const s = await getSubscription(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const settings = await getSettings(db);
  const manage = can(actor, "subscriptions.manage") && s.status === "active";
  return (
    <>
      <Link href="/ops/subscriptions" className="text-sm text-teal-700 hover:underline">← Subscriptions</Link>
      <div className="mt-4">
        <PageHeader
          title={`Subscription ${s.number}`}
          description={<><Link href={`/ops/customers/${s.customerOrgId}`} className="text-teal-700 underline">{s.customerName}</Link> · {s.quantity} × {s.description}</>}
          actions={<><LiveRefresh topics={["subscriptions", "invoices"]} /><StatusBadge status={s.status} /></>}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Card title="Current period">
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div><dt className="font-semibold">From</dt><dd><DateTime value={s.currentPeriodStart} dateOnly /></dd></div>
              <div><dt className="font-semibold">To</dt><dd><DateTime value={s.currentPeriodEnd} dateOnly /></dd></div>
              <div><dt className="font-semibold">Price per {s.billingPeriod}</dt><dd><Money minor={s.unitPriceMinor * s.quantity} currency={s.currency} /> excl. taxes</dd></div>
              <div><dt className="font-semibold">Renewal</dt><dd>{s.status !== "active" ? "—" : s.autoRenew ? `Automatic — invoice issued ${settings.renewalNoticeDays} days before the end` : "Off — ends at period end"}</dd></div>
              {s.sourceOrderId && <div><dt className="font-semibold">Started from</dt><dd><Link href={`/ops/orders/${s.sourceOrderId}`} className="text-teal-700">order</Link></dd></div>}
              {s.endReason && <div><dt className="font-semibold">Ended</dt><dd><DateTime value={s.endedAt} dateOnly /> — {s.endReason}</dd></div>}
            </dl>
          </Card>
          <Card title="Renewal invoices">
            {s.renewals.length === 0 ? (
              <EmptyState title="None yet" />
            ) : (
              <ul className="space-y-2 text-sm">
                {s.renewals.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/ops/invoices/${inv.id}`} className="font-medium text-teal-700">{inv.number}</Link>
                    <StatusBadge status={inv.status} />
                    <Money minor={inv.totalMinor} currency={inv.currency} /> · due <DateTime value={inv.dueAt} dateOnly />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        {manage && (
          <div className="min-w-0 space-y-6">
            <Card title="Renewal">
              <ActionForm action={subscriptionAction} submitLabel={s.autoRenew ? "Turn automatic renewal off" : "Turn automatic renewal on"} submitClassName="btn btn-ghost w-full">
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="autoRenew" value={s.autoRenew ? "false" : "true"} />
                {s.autoRenew && s.renewalInvoiceId && <p className="text-xs text-slate-600">An unpaid renewal invoice will be voided.</p>}
              </ActionForm>
            </Card>
            <Card title="Cancel now">
              <ActionForm action={subscriptionAction} submitLabel="Cancel subscription" submitClassName="btn btn-danger w-full" confirm="End this subscription immediately?">
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="op" value="cancel" />
                <Field label="Reason" htmlFor="reason"><input id="reason" name="reason" className="field" required minLength={3} maxLength={300} /></Field>
              </ActionForm>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
