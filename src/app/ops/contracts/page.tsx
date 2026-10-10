import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { contractState, listContracts, listSubscriptionCustomers } from "@/server/modules/subscriptions";
import { COVERAGE_LABEL, DEFAULT_SLA, describeTarget, PRIORITIES, type Coverage } from "@/server/modules/service-time";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, EmptyState, Field, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { cancelContractAction, createContractAction } from "../services-actions";

export const metadata: Metadata = { title: "Service contracts" };

export default async function ContractsPage() {
  const actor = await requireActor("operator");
  const db = getDb();
  const rows = await listContracts(db, actor).catch((e) => {
    if (e instanceof AppError) return null;
    throw e;
  });
  if (!rows) return <EmptyState title="You can't open this page" />;
  const manage = can(actor, "subscriptions.manage");
  const customers = manage ? await listSubscriptionCustomers(db) : [];
  const now = new Date();
  const year = now.getUTCFullYear();
  const defaults = DEFAULT_SLA.targets;
  return (
    <>
      <Link href="/ops/subscriptions" className="text-sm text-teal-700 hover:underline">← Subscriptions</Link>
      <div className="mt-4">
        <PageHeader title="Service contracts" description="Support terms per customer: coverage hours and response/resolution targets by priority. Customers without an active contract get the standard SLA shown below." />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <Card>
            {rows.length === 0 ? (
              <EmptyState title="No contracts yet" />
            ) : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Contract</th><th>Customer</th><th>Coverage</th><th>Urgent response</th><th>Period</th><th>Status</th></tr></thead>
                  <tbody>
                    {rows.map(({ c, customerName }) => {
                      const state = contractState(c, now);
                      return (
                        <tr key={c.id}>
                          <td><span className="font-medium">{c.number}</span><span className="block text-xs text-slate-600">{c.name}</span></td>
                          <td><Link href={`/ops/customers/${c.customerOrgId}`} className="hover:underline">{customerName}</Link></td>
                          <td className="text-xs">{COVERAGE_LABEL[c.coverage as Coverage]}</td>
                          <td className="text-xs">{describeTarget(c.slaTargets.urgent.responseMinutes, c.coverage as Coverage)}</td>
                          <td className="text-xs"><DateTime value={c.startsAt} dateOnly /> – <DateTime value={c.endsAt} dateOnly /></td>
                          <td>
                            <StatusBadge status={state} />
                            {manage && state === "active" && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-xs text-red-700 underline">Cancel</summary>
                                <ActionForm action={cancelContractAction} submitLabel="Cancel contract" submitClassName="btn btn-danger">
                                  <input type="hidden" name="id" value={c.id} />
                                  <Field label="Reason" htmlFor={`r-${c.id}`}><input id={`r-${c.id}`} name="reason" className="field" required minLength={3} /></Field>
                                </ActionForm>
                              </details>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
          <Card title="Standard SLA (no contract)">
            <p className="mb-2 text-sm text-slate-600">{COVERAGE_LABEL[DEFAULT_SLA.coverage]}. Ghana public holidays are not yet excluded from the clock.</p>
            <ul className="space-y-1 text-sm">
              {PRIORITIES.map((p) => (
                <li key={p}><span className="font-medium capitalize">{p}</span>: respond within {describeTarget(defaults[p].responseMinutes, DEFAULT_SLA.coverage)}, resolve within {describeTarget(defaults[p].resolutionMinutes, DEFAULT_SLA.coverage)}</li>
              ))}
            </ul>
          </Card>
        </div>
        {manage && (
          <Card title="New contract">
            <ActionForm action={createContractAction} submitLabel="Create contract" resetOnSuccess>
              <Field label="Customer" htmlFor="customerOrgId">
                <select id="customerOrgId" name="customerOrgId" className="field" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Name" htmlFor="name"><input id="name" name="name" className="field" required minLength={3} maxLength={120} placeholder="Managed network — Gold" /></Field>
              <Field label="Coverage" htmlFor="coverage">
                <select id="coverage" name="coverage" className="field" defaultValue="business_hours">
                  <option value="business_hours">{COVERAGE_LABEL.business_hours}</option>
                  <option value="24x7">{COVERAGE_LABEL["24x7"]}</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts" htmlFor="startsOn"><input id="startsOn" name="startsOn" type="date" className="field" required defaultValue={`${year}-01-01`} /></Field>
                <Field label="Ends" htmlFor="endsOn"><input id="endsOn" name="endsOn" type="date" className="field" required defaultValue={`${year}-12-31`} /></Field>
              </div>
              <fieldset className="rounded-lg border border-slate-200 p-3">
                <legend className="px-1 text-sm font-semibold">Targets (hours of covered time)</legend>
                <div className="space-y-2">
                  {PRIORITIES.map((p) => (
                    <div key={p} className="grid grid-cols-[70px_1fr_1fr] items-end gap-2">
                      <span className="pb-2 text-sm capitalize">{p}</span>
                      <Field label="Respond" htmlFor={`${p}Response`}><input id={`${p}Response`} name={`${p}Response`} type="number" step="0.25" min="0.25" className="field" required defaultValue={defaults[p].responseMinutes / 60} /></Field>
                      <Field label="Resolve" htmlFor={`${p}Resolution`}><input id={`${p}Resolution`} name={`${p}Resolution`} type="number" step="0.25" min="0.25" className="field" required defaultValue={defaults[p].resolutionMinutes / 60} /></Field>
                    </div>
                  ))}
                </div>
              </fieldset>
              <Field label="Notes (optional)" htmlFor="notes"><textarea id="notes" name="notes" rows={2} className="field" maxLength={2000} /></Field>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
