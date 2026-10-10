import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listSuppliers } from "@/server/modules/procurement";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { saveSupplierAction } from "../actions";

type Supplier = Awaited<ReturnType<typeof listSuppliers>>[number];

function SupplierFields({ s }: { s?: Supplier }) {
  const k = s?.id ?? "new";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Name" htmlFor={`n-${k}`}><input id={`n-${k}`} name="name" className="field" required defaultValue={s?.name} /></Field>
      <Field label="Contact person" htmlFor={`c-${k}`}><input id={`c-${k}`} name="contactName" className="field" defaultValue={s?.contactName ?? ""} /></Field>
      <Field label="E-mail (purchase orders are sent here)" htmlFor={`e-${k}`}><input id={`e-${k}`} name="email" type="email" className="field" defaultValue={s?.email ?? ""} /></Field>
      <Field label="Phone" htmlFor={`p-${k}`}><input id={`p-${k}`} name="phone" className="field" defaultValue={s?.phone ?? ""} /></Field>
      <Field label="Address" htmlFor={`a-${k}`}><input id={`a-${k}`} name="address" className="field" defaultValue={s?.address ?? ""} /></Field>
      <Field label="Tax ID (TIN)" htmlFor={`t-${k}`}><input id={`t-${k}`} name="taxId" className="field" defaultValue={s?.taxId ?? ""} /></Field>
      <Field label="Payment terms (days)" htmlFor={`d-${k}`}><input id={`d-${k}`} name="paymentTermsDays" type="number" min={0} className="field" defaultValue={s?.paymentTermsDays ?? 30} /></Field>
      <Field label="Notes" htmlFor={`o-${k}`}><input id={`o-${k}`} name="notes" className="field" defaultValue={s?.notes ?? ""} /></Field>
      {s && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={s.active} /> Active</label>}
    </div>
  );
}

export default async function SuppliersPage() {
  const actor = await requireActor("operator");
  const list = await listSuppliers(getDb(), actor);
  const canWrite = can(actor, "procurement.write");
  return (
    <>
      <PageHeader title="Suppliers" description="Vendors you buy hardware, licences and services from." />
      <div className="space-y-4">
        {list.length === 0 && <EmptyState title="No suppliers yet" />}
        {list.map((s) => (
          <Card key={s.id} title={s.name} actions={s.active ? <Badge tone="green">active</Badge> : <Badge>inactive</Badge>}>
            {canWrite ? (
              <details>
                <summary className="cursor-pointer text-sm text-slate-600">{[s.contactName, s.email, s.phone].filter(Boolean).join(" · ") || "No contact details"} — edit</summary>
                <ActionForm action={saveSupplierAction} submitLabel="Save" submitClassName="btn btn-ghost" className="mt-3 space-y-3">
                  <input type="hidden" name="id" value={s.id} />
                  <SupplierFields s={s} />
                </ActionForm>
              </details>
            ) : (
              <p className="text-sm text-slate-600">{[s.contactName, s.email, s.phone].filter(Boolean).join(" · ")}</p>
            )}
          </Card>
        ))}
      </div>
      {canWrite && (
        <Card title="Add supplier" className="mt-6">
          <ActionForm action={saveSupplierAction} submitLabel="Add supplier" resetOnSuccess>
            <SupplierFields />
          </ActionForm>
        </Card>
      )}
    </>
  );
}
