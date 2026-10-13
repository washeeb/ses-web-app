import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listLocations, LOCATION_KINDS } from "@/server/modules/inventory";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { locationAction } from "../../inventory-actions";

export const metadata: Metadata = { title: "Stock locations" };

type Loc = Awaited<ReturnType<typeof listLocations>>[number];

function LocationFields({ l }: { l: Loc | null }) {
  const p = l?.id ?? "new";
  return (
    <>
      {l && <input type="hidden" name="id" value={l.id} />}
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_12rem]">
        <Field label="Code" htmlFor={`code-${p}`}><input id={`code-${p}`} name="code" className="field uppercase" required pattern="[A-Za-z0-9\-]{2,16}" defaultValue={l?.code} /></Field>
        <Field label="Name" htmlFor={`name-${p}`}><input id={`name-${p}`} name="name" className="field" required maxLength={80} defaultValue={l?.name} /></Field>
        <Field label="Kind" htmlFor={`kind-${p}`}>
          <select id={`kind-${p}`} name="kind" className="field" defaultValue={l?.kind ?? "warehouse"}>
            {Object.entries(LOCATION_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Address" htmlFor={`addr-${p}`}><input id={`addr-${p}`} name="address" className="field" maxLength={300} defaultValue={l?.address ?? ""} /></Field>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="sellable" defaultChecked={l?.sellable ?? true} /> Stock here can be sold</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="isDefault" defaultChecked={l?.isDefault ?? false} /> Default for deliveries</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={l?.active ?? true} /> Open</label>
      </div>
    </>
  );
}

export default async function LocationsPage() {
  const actor = await requireActor("operator");
  if (!can(actor, "inventory.read")) return <EmptyState title="You can't open this page" />;
  const rows = await listLocations(getDb());
  const write = can(actor, "settings.manage");
  return (
    <>
      <PageHeader title="Stock locations" description="SES warehouses, store rooms, vehicles and shelves. Only stock at locations marked “can be sold” is offered in the store — use a non-sellable location for quarantined or damaged items." />
      <div className="grid gap-6 xl:grid-cols-2">
        {rows.filter((l) => !l.connectionId).map((l) => (
          <Card key={l.id} title={<>{l.name} <span className="text-sm font-normal text-slate-600">· {l.code}</span></>} actions={<span className="flex gap-1">{l.isDefault && <Badge tone="teal">default</Badge>}{!l.sellable && <Badge tone="amber">not for sale</Badge>}{!l.active && <Badge>closed</Badge>}</span>}>
            {write ? (
              <ActionForm action={locationAction} submitLabel="Save" submitClassName="btn btn-ghost">
                <LocationFields l={l} />
              </ActionForm>
            ) : (
              <p className="text-sm text-slate-700">{LOCATION_KINDS[l.kind as keyof typeof LOCATION_KINDS] ?? l.kind}{l.address ? ` · ${l.address}` : ""}</p>
            )}
          </Card>
        ))}
        {rows.some((l) => l.connectionId) && (
          <Card title="Partner locations">
            <p className="mb-2 text-sm text-slate-600">Stock here is reported by the partner and changes only through their feed.</p>
            <ul className="space-y-1 text-sm">{rows.filter((l) => l.connectionId).map((l) => <li key={l.id}>{l.name} <span className="font-mono text-xs text-slate-600">{l.code}</span></li>)}</ul>
          </Card>
        )}
        {write && (
          <Card title="New location">
            <ActionForm action={locationAction} submitLabel="Add location" resetOnSuccess>
              <LocationFields l={null} />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
