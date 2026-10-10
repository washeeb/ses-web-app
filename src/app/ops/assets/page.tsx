import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { listAssets } from "@/server/modules/assets";
import { listSubscriptionCustomers } from "@/server/modules/subscriptions";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, EmptyState, Field, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { createAssetAction } from "../services-actions";

export const metadata: Metadata = { title: "Assets" };

export default async function AssetsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireActor("operator");
  const { q } = await searchParams;
  const db = getDb();
  const rows = await listAssets(db, actor, { q }).catch((e) => {
    if (e instanceof AppError) return null;
    throw e;
  });
  if (!rows) return <EmptyState title="You can't open this page" />;
  const manage = can(actor, "assets.manage");
  const customers = manage ? await listSubscriptionCustomers(db) : [];
  return (
    <>
      <PageHeader title="Assets" description="Equipment SES supplied or supports, per customer. Hardware is registered automatically when an order is delivered; add serial numbers and locations here." actions={<LiveRefresh topics={["assets"]} />} />
      <form role="search" className="mb-4 flex max-w-md gap-2">
        <label htmlFor="q" className="sr-only">Search assets</label>
        <input id="q" name="q" defaultValue={q} placeholder="Tag, name or serial number" className="field" />
        <button className="btn btn-primary" type="submit">Search</button>
      </form>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          {rows.length === 0 ? (
            <EmptyState title="No assets found" />
          ) : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>Tag</th><th>Equipment</th><th>Customer</th><th>Serial</th><th>Status</th><th>Since</th></tr></thead>
                <tbody>
                  {rows.map(({ a, customerName }) => (
                    <tr key={a.id}>
                      <td><Link href={`/ops/assets/${a.id}`} className="font-medium text-teal-700 hover:underline">{a.tag}</Link></td>
                      <td className="max-w-xs truncate">{a.name}</td>
                      <td>{customerName}</td>
                      <td className="font-mono text-xs">{a.serialNumber ?? <span className="font-sans text-slate-500">not recorded</span>}</td>
                      <td><StatusBadge status={a.status} /></td>
                      <td><DateTime value={a.installedAt} dateOnly /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        {manage && (
          <Card title="Register equipment">
            <ActionForm action={createAssetAction} submitLabel="Register">
              <Field label="Customer" htmlFor="customerOrgId">
                <select id="customerOrgId" name="customerOrgId" className="field" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Name" htmlFor="name"><input id="name" name="name" className="field" required minLength={2} maxLength={200} placeholder="Core switch, 48-port" /></Field>
              <Field label="Serial number" htmlFor="serialNumber"><input id="serialNumber" name="serialNumber" className="field" maxLength={100} /></Field>
              <Field label="Location" htmlFor="location"><input id="location" name="location" className="field" maxLength={200} /></Field>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
