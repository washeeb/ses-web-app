import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { listDepartments } from "@/server/modules/admin";
import { can } from "@/server/authz/policy";
import { DEPARTMENT_MODULES, MODULES } from "@/content/modules";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, PageHeader } from "@/components/ui";
import { createDepartmentAction, toggleDepartmentAction } from "../actions";

export default async function DepartmentsPage() {
  const actor = await requireActor("operator");
  const depts = await listDepartments(getDb());
  const manage = can(actor, "departments.manage");
  return (
    <>
      <PageHeader title="Departments" description="Departments are configurable organisational units. They use shared modules; access comes from permission sets, optionally limited to one department." />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {depts.map((d) => (
          <Card key={d.id} title={d.name} actions={!d.active && <Badge tone="gray">inactive</Badge>}>
            <ul className="flex flex-wrap gap-1.5">
              {(DEPARTMENT_MODULES[d.key] ?? []).map((k) => {
                const m = MODULES.find((x) => x.key === k)!;
                return (
                  <li key={k}>
                    {m.status === "available" && m.href ? (
                      <Link href={m.href}><Badge tone="green">{m.name}</Badge></Link>
                    ) : (
                      <Badge tone="gray">{m.name} · {m.milestone}</Badge>
                    )}
                  </li>
                );
              })}
              {!DEPARTMENT_MODULES[d.key] && <li className="text-sm text-slate-500">No modules mapped yet.</li>}
            </ul>
            {manage && (
              <ActionForm action={toggleDepartmentAction} inline submitLabel={d.active ? "Deactivate" : "Activate"} submitClassName="btn btn-ghost mt-3 px-2 py-1 text-xs">
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="active" value={String(!d.active)} />
              </ActionForm>
            )}
          </Card>
        ))}
      </div>
      {manage && (
        <Card title="Add department" className="mt-6">
          <ActionForm action={createDepartmentAction} submitLabel="Add department" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Key" htmlFor="key" hint="Lowercase identifier, e.g. field_services">
                <input id="key" name="key" className="field" required pattern="[a-z][a-z0-9_]{1,40}" />
              </Field>
              <Field label="Name" htmlFor="dname">
                <input id="dname" name="name" className="field" required />
              </Field>
              <Field label="Description" htmlFor="ddesc">
                <input id="ddesc" name="description" className="field" />
              </Field>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
