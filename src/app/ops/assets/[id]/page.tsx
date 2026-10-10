import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getAsset } from "@/server/modules/assets";
import { listContracts } from "@/server/modules/subscriptions";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, EmptyState, Field, PageHeader, StatusBadge } from "@/components/ui";
import { PriorityBadge } from "@/components/service-ui";
import { updateAssetAction } from "../../services-actions";

export const metadata: Metadata = { title: "Asset" };

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const a = await getAsset(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const manage = can(actor, "assets.manage");
  const contracts = manage ? await listContracts(db, actor, { customerOrgId: a.customerOrgId }) : [];
  const now = new Date();
  return (
    <>
      <Link href="/ops/assets" className="text-sm text-teal-700 hover:underline">← Assets</Link>
      <div className="mt-4">
        <PageHeader
          title={`${a.tag}: ${a.name}`}
          description={<><Link href={`/ops/customers/${a.customerOrgId}`} className="text-teal-700 underline">{a.customerName}</Link>{a.orderNumber && <> · supplied on order <Link href={`/ops/orders/${a.orderId}`} className="text-teal-700 underline">{a.orderNumber}</Link></>}</>}
          actions={<StatusBadge status={a.status} />}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <Card title="Cover">
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div><dt className="font-semibold">Warranty</dt><dd>{a.warrantyEndsAt ? <>{a.warrantyEndsAt > now ? "until" : "ended"} <DateTime value={a.warrantyEndsAt} dateOnly /></> : "None recorded"}</dd></div>
              <div><dt className="font-semibold">Service contract</dt><dd>{a.contractNumber ? `${a.contractNumber} — ${a.contractName}` : "None linked"}</dd></div>
              <div><dt className="font-semibold">Installed</dt><dd><DateTime value={a.installedAt} dateOnly /></dd></div>
            </dl>
          </Card>
          <Card title="Support history" actions={can(actor, "support.write") ? <Link href={`/ops/support/new?customer=${a.customerOrgId}`} className="btn btn-ghost">New ticket</Link> : undefined}>
            {a.tickets.length === 0 ? (
              <EmptyState title="No tickets for this equipment" />
            ) : (
              <ul className="space-y-2 text-sm">
                {a.tickets.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/ops/support/${t.id}`} className="font-medium text-teal-700">{t.number}</Link>
                    <PriorityBadge priority={t.priority} /><StatusBadge status={t.status} />
                    <span className="text-slate-700">{t.subject}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title={manage ? "Details" : "Details"}>
          {manage ? (
            <ActionForm action={updateAssetAction} submitLabel="Save">
              <input type="hidden" name="id" value={a.id} />
              <Field label="Name" htmlFor="name"><input id="name" name="name" className="field" required defaultValue={a.name} maxLength={200} /></Field>
              <Field label="Serial number" htmlFor="serialNumber"><input id="serialNumber" name="serialNumber" className="field" defaultValue={a.serialNumber ?? ""} maxLength={100} /></Field>
              <Field label="Location" htmlFor="location"><input id="location" name="location" className="field" defaultValue={a.location ?? ""} maxLength={200} /></Field>
              <Field label="Status" htmlFor="status">
                <select id="status" name="status" className="field" defaultValue={a.status}>
                  <option value="active">Active</option><option value="in_repair">In repair</option><option value="retired">Retired</option>
                </select>
              </Field>
              <Field label="Service contract" htmlFor="contractId">
                <select id="contractId" name="contractId" className="field" defaultValue={a.contractId ?? ""}>
                  <option value="">None</option>
                  {contracts.map(({ c }) => <option key={c.id} value={c.id}>{c.number} — {c.name}</option>)}
                </select>
              </Field>
              <Field label="Notes" htmlFor="notes"><textarea id="notes" name="notes" rows={3} className="field" defaultValue={a.notes ?? ""} maxLength={2000} /></Field>
            </ActionForm>
          ) : (
            <dl className="space-y-2 text-sm">
              <div><dt className="font-semibold">Serial number</dt><dd>{a.serialNumber ?? "—"}</dd></div>
              <div><dt className="font-semibold">Location</dt><dd>{a.location ?? "—"}</dd></div>
              {a.notes && <div><dt className="font-semibold">Notes</dt><dd className="whitespace-pre-line">{a.notes}</dd></div>}
            </dl>
          )}
        </Card>
      </div>
    </>
  );
}
