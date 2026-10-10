import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { listRecurringVariants, listSubscriptionCustomers, listSubscriptions } from "@/server/modules/subscriptions";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, EmptyState, Field, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { createSubscriptionAction } from "../services-actions";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function SubscriptionsPage() {
  const actor = await requireActor("operator");
  const db = getDb();
  const rows = await listSubscriptions(db, actor).catch((e) => {
    if (e instanceof AppError) return null;
    throw e;
  });
  if (!rows) return <EmptyState title="You can't open this page" />;
  const manage = can(actor, "subscriptions.manage");
  const [customers, variants] = manage ? await Promise.all([listSubscriptionCustomers(db), listRecurringVariants(db)]) : [[], []];
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Recurring services and licences. Renewal invoices are issued automatically before each period ends; paid renewals extend the period, unpaid ones lapse after the grace period."
        actions={<><LiveRefresh topics={["subscriptions"]} /><Link href="/ops/contracts" className="btn btn-ghost">Service contracts</Link></>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          {rows.length === 0 ? (
            <EmptyState title="No subscriptions yet">They start when an order with monthly or yearly items is delivered.</EmptyState>
          ) : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Subscription</th><th>Customer</th><th>Status</th><th>Period ends</th><th className="text-right">Per period</th></tr></thead>
                <tbody>
                  {rows.map(({ s, customerName }) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/ops/subscriptions/${s.id}`} className="font-medium text-teal-700 hover:underline">{s.number}</Link>
                        <span className="block max-w-xs truncate text-xs text-slate-600">{s.quantity} × {s.description}</span>
                      </td>
                      <td>{customerName}</td>
                      <td className="space-x-1"><StatusBadge status={s.status} />{s.status === "active" && !s.autoRenew && <span className="text-xs text-slate-600">ends</span>}</td>
                      <td><DateTime value={s.currentPeriodEnd} dateOnly /></td>
                      <td className="text-right"><Money minor={s.unitPriceMinor * s.quantity} currency={s.currency} /> / {s.billingPeriod}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        {manage && (
          <Card title="Record a subscription">
            <ActionForm action={createSubscriptionAction} submitLabel="Create subscription">
              <p className="text-xs text-slate-600">For services sold outside the store, such as an existing customer moving onto the platform.</p>
              <Field label="Customer" htmlFor="customerOrgId">
                <select id="customerOrgId" name="customerOrgId" className="field" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Product option" htmlFor="variantId">
                <select id="variantId" name="variantId" className="field" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {variants.map((v) => <option key={v.id} value={v.id}>{v.sku} — {v.name} ({v.billingPeriod}ly)</option>)}
                </select>
              </Field>
              <Field label="Quantity" htmlFor="quantity"><input id="quantity" name="quantity" type="number" min={1} defaultValue={1} className="field" required /></Field>
              <Field label="Current period starts" htmlFor="startsOn"><input id="startsOn" name="startsOn" type="date" className="field" defaultValue={today} required /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="autoRenew" defaultChecked /> Renew automatically</label>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
