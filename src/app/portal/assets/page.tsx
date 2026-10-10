import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listAssets } from "@/server/modules/assets";
import { Card, DateTime, EmptyState, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Equipment" };

export default async function PortalAssets() {
  const actor = await requireActor("customer");
  const rows = await listAssets(getDb(), actor);
  const canRaise = can(actor, "customer.tickets.write", { organizationId: actor.organizationId });
  return (
    <>
      <PageHeader title="Equipment" description="Equipment SES supplied or supports for you. Quote the tag when you contact us." actions={<LiveRefresh topics={["assets"]} />} />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No equipment registered" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Tag</th><th>Equipment</th><th>Serial</th><th>Location</th><th>Status</th><th>Since</th>{canRaise && <th><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {rows.map(({ a }) => (
                  <tr key={a.id}>
                    <td className="font-medium">{a.tag}</td>
                    <td className="max-w-xs">{a.name}</td>
                    <td className="font-mono text-xs">{a.serialNumber ?? "—"}</td>
                    <td>{a.location ?? "—"}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td><DateTime value={a.installedAt} dateOnly /></td>
                    {canRaise && <td><Link href={`/portal/support/new?asset=${a.id}`} className="text-teal-700 underline">Report a problem<span className="sr-only"> with {a.tag}</span></Link></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
