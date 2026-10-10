import Link from "next/link";
import { notFound } from "next/navigation";
import { isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { stockLocations } from "@/server/db/schema";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getReturn } from "@/server/modules/returns";
import { ActionForm } from "@/components/action-form";
import { ReturnView } from "@/components/return-view";
import { Card, Field, PageHeader } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { returnStaffAction } from "../actions";

export default async function StaffReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const db = getDb();
  const d = await getReturn(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const manage = can(actor, "returns.manage");
  const locations = await db.select().from(stockLocations).where(isNull(stockLocations.connectionId));
  const restockable = d.lines.some((l) => l.tracksStock);
  const { r } = d;
  return (
    <>
      <PageHeader title={`${r.number}`} description={<Link href={`/ops/orders/${d.order.id}`} className="text-teal-700 hover:underline">Open order {d.order.number}</Link>} actions={<LiveRefresh topics={["returns", "approvals"]} />} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <ReturnView d={d} />
        </Card>
        <div className="min-w-0 space-y-6">
          {manage && r.status === "requested" && (
            <Card title="Decide">
              <ActionForm action={returnStaffAction} className="space-y-3">
                <input type="hidden" name="id" value={r.id} />
                <Field label="Note to the customer (required when rejecting)" htmlFor="note">
                  <textarea id="note" name="note" rows={2} className="field" maxLength={1000} />
                </Field>
                <div className="flex gap-2">
                  <button name="op" value="approve" className="btn btn-accent flex-1">Approve</button>
                  <button name="op" value="reject" className="btn btn-danger flex-1">Reject</button>
                </div>
              </ActionForm>
            </Card>
          )}
          {manage && r.status === "approved" && (
            <Card title="Receive items">
              <ActionForm action={returnStaffAction} submitLabel="Record as received" submitClassName="btn btn-primary w-full">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="op" value="receive" />
                {restockable && (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="restock" /> Items are resellable — put back into stock
                    </label>
                    <Field label="Restock location" htmlFor="locationId">
                      <select id="locationId" name="locationId" className="field">
                        {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </Field>
                  </>
                )}
                {r.resolution === "refund" && <p className="text-xs text-slate-500">A refund approval request is created automatically. Someone else with refund authority must approve it.</p>}
              </ActionForm>
            </Card>
          )}
          {manage && r.status === "received" && (
            <Card title="Complete">
              <ActionForm action={returnStaffAction} submitLabel="Mark completed" submitClassName="btn btn-accent w-full">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="op" value="complete" />
                <Field label="What was done" htmlFor="cnote" hint="e.g. Replacement dispatched with waybill 1234; repaired and returned.">
                  <input id="cnote" name="note" className="field" required minLength={3} />
                </Field>
              </ActionForm>
            </Card>
          )}
          {r.status === "refund_pending" && (
            <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-900">
              Refund awaiting approval. <Link href="/ops/approvals" className="font-semibold underline">Open approvals</Link>. After approval, pay the refund through your bank or Paystack dashboard.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
