import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { listDepartments, listOrganizations, listPermissionSets, listUsers } from "@/server/modules/admin";
import { can } from "@/server/authz/policy";
import { PERMISSIONS, type Permission } from "@/server/authz/permissions";
import { ActionForm } from "@/components/action-form";
import { Ago, Badge, Card, Field, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { assignRoleAction, createUserAction, revokeAssignmentAction, userStatusAction } from "../../actions";

export default async function UsersPage() {
  const actor = await requireActor("operator");
  const db = getDb();
  const [users, sets, depts, orgs] = await Promise.all([listUsers(db, actor), listPermissionSets(db), listDepartments(db), listOrganizations(db, actor)]);
  const managePerms = can(actor, "permissions.manage");
  const manageUsers = can(actor, "users.manage");
  return (
    <>
      <PageHeader
        title="Users & access"
        description="Access comes from permission sets assigned within the user's own organisation, optionally limited to a department. Privileged sets need a second administrator's approval; nobody can change their own access."
      />
      <Card>
        <TableWrap>
          <table className="table">
            <thead><tr><th>User</th><th>Organisation</th><th>Access</th><th>Security</th>{(managePerms || manageUsers) && <th>Manage</th>}</tr></thead>
            <tbody>
              {users.map((u) => {
                const self = u.id === actor.userId;
                const eligible = sets.filter((s) => s.domain === u.organizationType);
                return (
                  <tr key={u.id}>
                    <td>
                      <p className="font-medium">{u.name}</p>
                      <p className="text-xs text-slate-500">{u.email}</p>
                    </td>
                    <td>
                      <p>{u.organizationName}</p>
                      <Badge>{u.organizationType}</Badge>
                    </td>
                    <td>
                      <ul className="space-y-1">
                        {u.assignments.map(({ a, setName, deptName }) => (
                          <li key={a.id} className="flex flex-wrap items-center gap-1 text-xs">
                            <Badge tone="blue">{setName}</Badge>
                            {deptName && <span className="text-slate-500">· {deptName}</span>}
                            {managePerms && !self && (
                              <ActionForm action={revokeAssignmentAction} inline submitLabel="Remove" submitClassName="text-xs text-red-700 hover:underline" confirm={`Remove ${setName} from ${u.name}?`}>
                                <input type="hidden" name="id" value={a.id} />
                              </ActionForm>
                            )}
                          </li>
                        ))}
                        {u.assignments.length === 0 && <li className="text-xs text-slate-500">No access</li>}
                      </ul>
                    </td>
                    <td className="text-xs">
                      <StatusBadge status={u.status} />
                      <p className="mt-1">{u.mfaEnabled ? "MFA on" : "MFA off"}</p>
                      <p>Last sign-in <Ago value={u.lastLoginAt} /></p>
                      {u.lockedUntil && u.lockedUntil > new Date() && <Badge tone="red">locked</Badge>}
                    </td>
                    {(managePerms || manageUsers) && (
                      <td className="min-w-64 space-y-2">
                        {self ? (
                          <p className="text-xs text-slate-500">You cannot change your own access.</p>
                        ) : (
                          <>
                            {managePerms && (
                              <ActionForm action={assignRoleAction} className="space-y-1" submitLabel="Grant" submitClassName="btn btn-ghost px-2 py-1 text-xs">
                                <input type="hidden" name="userId" value={u.id} />
                                <label className="sr-only" htmlFor={`set-${u.id}`}>Permission set</label>
                                <select id={`set-${u.id}`} name="permissionSetId" className="field py-1 text-xs">
                                  {eligible.map((s) => {
                                    const priv = s.permissions.some((p) => PERMISSIONS[p as Permission]?.privileged);
                                    return <option key={s.id} value={s.id}>{s.name}{priv ? " (needs approval)" : ""}</option>;
                                  })}
                                </select>
                                {u.organizationType === "operator" && (
                                  <>
                                    <label className="sr-only" htmlFor={`dept-${u.id}`}>Limit to department</label>
                                    <select id={`dept-${u.id}`} name="departmentId" className="field py-1 text-xs">
                                      <option value="">All departments</option>
                                      {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                                    </select>
                                  </>
                                )}
                              </ActionForm>
                            )}
                            {manageUsers && (
                              <ActionForm action={userStatusAction} inline submitLabel={u.status === "active" ? "Disable account" : "Enable account"} submitClassName="text-xs text-slate-700 underline">
                                <input type="hidden" name="id" value={u.id} />
                                <input type="hidden" name="status" value={u.status === "active" ? "disabled" : "active"} />
                              </ActionForm>
                            )}
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
      {manageUsers && (
        <Card title="Invite a user" className="mt-6">
          <ActionForm action={createUserAction} submitLabel="Create account" resetOnSuccess>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Name" htmlFor="nu-name"><input id="nu-name" name="name" className="field" required /></Field>
              <Field label="E-mail" htmlFor="nu-email"><input id="nu-email" name="email" type="email" className="field" required /></Field>
              <Field label="Organisation" htmlFor="nu-org">
                <select id="nu-org" name="organizationId" className="field">
                  {orgs.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.type})</option>)}
                </select>
              </Field>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
