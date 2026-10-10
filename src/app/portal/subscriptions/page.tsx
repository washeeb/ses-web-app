import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { contractState, listContracts, listSubscriptions } from "@/server/modules/subscriptions";
import { getSettings } from "@/server/modules/settings";
import { COVERAGE_LABEL, describeTarget, PRIORITIES, type Coverage } from "@/server/modules/service-time";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, EmptyState, Money, PageHeader, StatusBadge } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { autoRenewAction } from "../services-actions";

export const metadata: Metadata = { title: "Subscriptions & contracts" };

export default async function PortalSubscriptions() {
  const actor = await requireActor("customer");
  const db = getDb();
  const [subs, contracts, settings] = await Promise.all([listSubscriptions(db, actor), listContracts(db, actor), getSettings(db)]);
  const manage = can(actor, "customer.subscriptions.manage", { organizationId: actor.organizationId });
  const now = new Date();
  return (
    <>
      <PageHeader
        title="Subscriptions & contracts"
        description={`Recurring services and your support terms. We send the renewal invoice ${settings.renewalNoticeDays} days before each period ends.`}
        actions={<LiveRefresh topics={["subscriptions", "invoices"]} />}
      />
      <div className="space-y-6">
        <Card title="Subscriptions">
          {subs.length === 0 ? (
            <EmptyState title="No subscriptions" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {subs.map(({ s }) => (
                <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{s.quantity} × {s.description}</p>
                    <p className="text-sm text-slate-600">
                      {s.number} · <Money minor={s.unitPriceMinor * s.quantity} currency={s.currency} /> per {s.billingPeriod} excl. taxes · current period <DateTime value={s.currentPeriodStart} dateOnly /> – <DateTime value={s.currentPeriodEnd} dateOnly />
                    </p>
                    {s.status === "active" && (
                      <p className="text-sm text-slate-600">
                        {s.autoRenew ? "Renews automatically." : <>Ends <DateTime value={s.currentPeriodEnd} dateOnly />.</>}
                        {s.renewalInvoiceId && <> Renewal invoice: <Link href={`/portal/invoices/${s.renewalInvoiceId}`} className="text-teal-700">view and pay</Link>.</>}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <StatusBadge status={s.status} />
                    {manage && s.status === "active" && (
                      <ActionForm
                        action={autoRenewAction}
                        inline
                        submitLabel={<>{s.autoRenew ? "Stop renewal" : "Renew automatically"}<span className="sr-only">: {s.description}</span></>}
                        submitClassName="btn btn-ghost"
                        confirm={s.autoRenew ? "Stop automatic renewal? The service ends when the current period ends." : undefined}
                      >
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="autoRenew" value={s.autoRenew ? "false" : "true"} />
                      </ActionForm>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Service contracts">
          {contracts.length === 0 ? (
            <EmptyState title="No service contract">Support follows our standard business-hours service levels. Ask us about a contract with faster response.</EmptyState>
          ) : (
            <ul className="space-y-4">
              {contracts.map(({ c }) => (
                <li key={c.id}>
                  <p className="flex flex-wrap items-center gap-2 font-medium">{c.name} <StatusBadge status={contractState(c, now)} /></p>
                  <p className="text-sm text-slate-600">{c.number} · <DateTime value={c.startsAt} dateOnly /> – <DateTime value={c.endsAt} dateOnly /> · {COVERAGE_LABEL[c.coverage as Coverage]}</p>
                  <ul className="mt-1 text-sm text-slate-700">
                    {PRIORITIES.map((p) => (
                      <li key={p}><span className="capitalize">{p}</span>: response within {describeTarget(c.slaTargets[p].responseMinutes, c.coverage as Coverage)}, resolution within {describeTarget(c.slaTargets[p].resolutionMinutes, c.coverage as Coverage)}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
