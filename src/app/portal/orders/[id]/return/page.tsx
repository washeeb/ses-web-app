import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { getOrder } from "@/server/modules/sales";
import { returnableLines, withinReturnWindow } from "@/server/modules/returns";
import { getSettings } from "@/server/modules/settings";
import { ActionForm } from "@/components/action-form";
import { Card, DateTime, EmptyState, Field, PageHeader } from "@/components/ui";
import { requestReturnAction } from "../../../returns/actions";


export default async function RequestReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("customer");
  const db = getDb();
  const o = await getOrder(db, actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  if (!can(actor, "customer.returns.request", { organizationId: o.customerOrgId })) {
    return <EmptyState title="Your account cannot request returns">Ask your organisation&apos;s administrator.</EmptyState>;
  }
  if (o.status !== "fulfilled" || !o.fulfilledAt) return <EmptyState title="Returns open once the order is delivered" />;
  const s = await getSettings(db);
  const lines = (await returnableLines(db, o.id)).filter((l) => l.returnable > 0);
  const windowOpen = withinReturnWindow(o.fulfilledAt, s.returnWindowDays);
  const anyWarranty = lines.some((l) => l.warrantyEndsAt);
  if (lines.length === 0) return <EmptyState title="Nothing left to return on this order" />;
  if (!windowOpen && !anyWarranty) return <EmptyState title="The return window has closed">No items on this order are under warranty.</EmptyState>;
  return (
    <>
      <Link href={`/portal/orders/${o.id}`} className="text-sm text-teal-700 hover:underline">← Order {o.number}</Link>
      <div className="mt-4">
        <PageHeader title="Return or warranty claim" description={<>Delivered <DateTime value={o.fulfilledAt} dateOnly />. Returns are possible within {s.returnWindowDays} days; faults can be claimed while under warranty.</>} />
      </div>
      <Card>
        <ActionForm action={requestReturnAction} submitLabel="Submit request">
          <input type="hidden" name="orderId" value={o.id} />
          <fieldset className="space-y-2">
            <legend className="field-label">What kind of request?</legend>
            {windowOpen && (
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="kind" value="return" defaultChecked required /> Return (changed mind, wrong or damaged item)</label>
            )}
            {anyWarranty && (
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="kind" value="warranty" defaultChecked={!windowOpen} required /> Warranty claim (item has developed a fault)</label>
            )}
          </fieldset>
          <Field label="What would you like?" htmlFor="resolution" hint="Repairs apply to warranty claims.">
            <select id="resolution" name="resolution" className="field">
              <option value="replacement">Replacement</option>
              <option value="refund">Refund</option>
              {anyWarranty && <option value="repair">Repair</option>}
            </select>
          </Field>
          <fieldset className="space-y-2">
            <legend className="field-label">Items and quantities</legend>
            {lines.map(({ line, returnable, warrantyEndsAt }) => (
              <div key={line.id} className="grid items-center gap-2 sm:grid-cols-[1fr_7rem]">
                <input type="hidden" name="lineId" value={line.id} />
                <label htmlFor={`qty-${line.id}`} className="text-sm">
                  {line.description}
                  <span className="block text-xs text-slate-500">
                    up to {returnable}{warrantyEndsAt ? <> · under warranty until <DateTime value={warrantyEndsAt} dateOnly /></> : " · no warranty"}
                  </span>
                </label>
                <input id={`qty-${line.id}`} name={`qty-${line.id}`} type="number" min={0} max={returnable} defaultValue={0} className="field" />
              </div>
            ))}
          </fieldset>
          <Field label="Describe the problem" htmlFor="reason">
            <textarea id="reason" name="reason" rows={4} className="field" required minLength={10} maxLength={2000} />
          </Field>
        </ActionForm>
      </Card>
    </>
  );
}
