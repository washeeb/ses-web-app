import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { organizations } from "@/server/db/schema";
import { requireActor } from "@/server/web/session";
import { listConnections } from "@/server/modules/integrations/manage";
import { can } from "@/server/authz/policy";
import { ActionForm } from "@/components/action-form";
import { Ago, Badge, Card, EmptyState, Field, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import { createConnectionAction } from "../actions";

export default async function IntegrationsPage() {
  const actor = await requireActor("operator");
  const db = getDb();
  const connections = await listConnections(db, actor);
  const partners = await db.select().from(organizations).where(eq(organizations.type, "partner"));
  const simulatorsEnabled = process.env.SIMULATORS_ENABLED === "true";
  return (
    <>
      <PageHeader
        title="Partner integrations"
        description="Signed webhooks in, signed deliveries out, with de-duplication, ordering, retries and dead-letter handling. Targets: stock and price changes visible within 10 s (p95); order updates to partners within 30 s, retried for up to 24 h."
        actions={<LiveRefresh topics={["integrations", "stock", "catalogue"]} />}
      />
      <Card>
        {connections.length === 0 ? (
          <EmptyState title="No connections yet" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Connection</th><th>Mode</th><th>Status</th><th>Health</th><th>Last event</th><th>Last sync</th><th>Events 24 h</th></tr></thead>
              <tbody>
                {connections.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/ops/integrations/${c.id}`} className="font-medium text-teal-700 hover:underline">{c.name}</Link>
                      <p className="text-xs text-slate-500">{c.partnerName}</p>
                    </td>
                    <td><StatusBadge status={c.mode} /></td>
                    <td><StatusBadge status={c.status} /></td>
                    <td>
                      <StatusBadge status={c.health.state} />
                      {c.health.staleStockRows > 0 && <p className="text-xs text-amber-700">{c.health.staleStockRows} stale stock rows</p>}
                      {c.health.dead + c.health.deadOutbound > 0 && <p className="text-xs text-red-700">{c.health.dead + c.health.deadOutbound} dead-lettered</p>}
                    </td>
                    <td className="text-xs"><Ago value={c.lastEventAt} /></td>
                    <td className="text-xs"><Ago value={c.lastSyncAt} /></td>
                    <td className="text-xs">
                      {Object.entries(c.health.counts24h).map(([k, n]) => (
                        <span key={k} className="mr-2 whitespace-nowrap">{k.replace("_", " ")}: {n}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      {can(actor, "integrations.manage") && (
        <Card title="New connection" className="mt-6">
          <p className="mb-4 text-sm text-slate-600">
            Create a <strong>production</strong> connection only once a partner&apos;s system exists and the endpoint, data contract and commercial terms are agreed.
            Simulator connections exist for testing and never contact real partner systems. <Badge tone="purple">KingsView: simulator only</Badge>
          </p>
          <ActionForm action={createConnectionAction} submitLabel="Create connection">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Partner" htmlFor="partnerOrgId">
                <select id="partnerOrgId" name="partnerOrgId" className="field" required>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Connection name" htmlFor="name">
                <input id="name" name="name" className="field" required minLength={3} />
              </Field>
              <Field label="Mode" htmlFor="mode">
                <select id="mode" name="mode" className="field" defaultValue={simulatorsEnabled ? "simulator" : "production"}>
                  {simulatorsEnabled && <option value="simulator">Simulator</option>}
                  <option value="production">Production</option>
                </select>
              </Field>
              <Field label="Partner endpoint for SES events (optional)" htmlFor="outboundUrl" hint="HTTPS required in production.">
                <input id="outboundUrl" name="outboundUrl" className="field" type="url" />
              </Field>
              <Field label="Stock is stale after (minutes)" htmlFor="staleAfterMinutes">
                <input id="staleAfterMinutes" name="staleAfterMinutes" type="number" min={1} defaultValue={15} className="field" />
              </Field>
              <Field label="Price changes needing approval (≥ %)" htmlFor="sensitivePercent">
                <input id="sensitivePercent" name="sensitivePercent" type="number" min={1} step="0.5" defaultValue={15} className="field" />
              </Field>
              <Field label="Default markup on partner cost (%)" htmlFor="markupPercent">
                <input id="markupPercent" name="markupPercent" type="number" min={0} step="0.5" defaultValue={20} className="field" />
              </Field>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
