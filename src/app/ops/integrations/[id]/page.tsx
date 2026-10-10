import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { getConnectionDetail } from "@/server/modules/integrations/manage";
import { API_SCOPES, CONTRACT_VERSION } from "@/server/modules/integrations/contracts";
import { can } from "@/server/authz/policy";
import { AppError } from "@/server/lib/errors";
import { SCENARIOS } from "@/simulators/kingsview/runner";
import { SIMULATOR_NOTICE } from "@/simulators/kingsview/simulator";
import { simulatorInbox } from "@/simulators/kingsview/inbox";
import { ActionForm } from "@/components/action-form";
import { Ago, Badge, Card, DateTime, EmptyState, Field, Money, PageHeader, Stat, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";
import {
  connectionStatusAction,
  createApiKeyAction,
  replayEventAction,
  revokeApiKeyAction,
  rotateSecretsAction,
  simulatorAction,
  updateMappingAction,
} from "../../actions";

export default async function ConnectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor("operator");
  const d = await getConnectionDetail(getDb(), actor, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const { connection: c, health } = d;
  const manage = can(actor, "integrations.manage");
  const isSim = c.mode === "simulator";
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const inbox = isSim ? simulatorInbox().filter((m) => m.connectionId === c.id).slice(0, 10) : [];
  return (
    <>
      <PageHeader
        title={c.name}
        description={<>Partner: {d.partner.name} · contract {CONTRACT_VERSION} · stale after {Math.round(c.staleAfterSeconds / 60)} min · approval at ≥{c.sensitivePriceChangeBp / 100}% price change</>}
        actions={
          <>
            <LiveRefresh topics={["integrations", "catalogue", "stock", "orders"]} />
            <StatusBadge status={c.mode} />
            <StatusBadge status={c.status} />
          </>
        }
      />
      {isSim && <p className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-900"><strong>Simulator connection.</strong> {SIMULATOR_NOTICE} It never contacts KingsView systems.</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Health" value={<StatusBadge status={health.state} />} />
        <Stat label="Last event" value={<span className="text-base"><Ago value={c.lastEventAt} /></span>} />
        <Stat label="Last sync" value={<span className="text-base"><Ago value={c.lastSyncAt} /></span>} />
        <Stat label="Failing / dead" value={`${health.failing} / ${health.dead + health.deadOutbound}`} tone={health.dead + health.deadOutbound ? "red" : health.failing ? "amber" : undefined} />
        <Stat label="Stale stock rows" value={health.staleStockRows} tone={health.staleStockRows ? "amber" : undefined} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <Card title="Product mappings">
            {d.mappings.length === 0 ? (
              <EmptyState title="No mapped products">Products appear when the partner sends product.upserted events.</EmptyState>
            ) : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Partner SKU → SES</th><th className="text-right">Cost</th><th className="text-right">Sell</th><th className="text-right">Stock</th><th>Synced</th>{manage && <th>Ownership & markup</th>}</tr></thead>
                  <tbody>
                    {d.mappings.map((m) => (
                      <tr key={m.mapping.id}>
                        <td>
                          <p className="font-mono text-xs">{m.mapping.partnerSku}</p>
                          <Link href={`/ops/catalogue/${m.productId}`} className="text-teal-700 hover:underline">{m.productName}</Link> <StatusBadge status={m.productStatus} />
                        </td>
                        <td className="text-right">{m.mapping.partnerCostMinor !== null ? <Money minor={m.mapping.partnerCostMinor} /> : "—"}</td>
                        <td className="text-right"><Money minor={m.priceMinor} currency={m.currency} /></td>
                        <td className="text-right">{m.onHand}{m.reserved > 0 && <span className="text-xs text-slate-500"> ({m.reserved} held)</span>}{m.stockStale && <Badge tone="amber">stale</Badge>}</td>
                        <td className="text-xs"><Ago value={m.mapping.lastSyncedAt} /></td>
                        {manage && (
                          <td>
                            <ActionForm action={updateMappingAction} className="flex flex-wrap items-end gap-1" submitLabel="Save" submitClassName="btn btn-ghost px-2 py-1 text-xs">
                              <input type="hidden" name="id" value={m.mapping.id} />
                              <input type="hidden" name="connectionId" value={c.id} />
                              {(["name", "description", "cost", "stock", "status"] as const).map((f) => (
                                <label key={f} className="text-[11px]">
                                  {f}
                                  <select name={f} defaultValue={m.mapping.fieldOwnership[f]} className="field block px-1 py-0.5 text-xs">
                                    <option value="partner">partner</option>
                                    <option value="ses">SES</option>
                                  </select>
                                </label>
                              ))}
                              <label className="text-[11px]">
                                markup %
                                <input name="markupPercent" type="number" step="0.5" min={0} className="field block w-16 px-1 py-0.5 text-xs" defaultValue={m.mapping.priceRule.type === "markup" ? m.mapping.priceRule.bp / 100 : 0} />
                              </label>
                            </ActionForm>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card title="Inbound events (latest 100)">
            {d.events.length === 0 ? (
              <EmptyState title="No events received yet" />
            ) : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Received</th><th>Type</th><th>Event id / version</th><th>Status</th><th>Note</th>{manage && <th />}</tr></thead>
                  <tbody>
                    {d.events.map((e) => (
                      <tr key={e.id}>
                        <td className="whitespace-nowrap text-xs"><DateTime value={e.receivedAt} /></td>
                        <td className="font-mono text-xs">{e.type}</td>
                        <td className="font-mono text-[11px] text-slate-500">{e.eventId}<br />v{e.version}</td>
                        <td><StatusBadge status={e.status} />{e.attempts > 1 && <span className="ml-1 text-xs text-slate-500">×{e.attempts}</span>}</td>
                        <td className="max-w-xs text-xs text-slate-600">{e.lastError}</td>
                        {manage && (
                          <td>
                            {["failed", "dead"].includes(e.status) && (
                              <ActionForm action={replayEventAction} inline submitLabel="Replay" submitClassName="btn btn-ghost px-2 py-1 text-xs">
                                <input type="hidden" name="id" value={e.id} />
                                <input type="hidden" name="connectionId" value={c.id} />
                              </ActionForm>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          <Card title="Outbound deliveries to partner">
            {d.outbound.length === 0 ? (
              <EmptyState title="Nothing sent yet">Confirmed orders with partner-sourced lines create fulfilment requests here.</EmptyState>
            ) : (
              <TableWrap>
                <table className="table">
                  <thead><tr><th>Created</th><th>Event</th><th>Status</th><th>Attempts</th><th>Next try / error</th>{manage && <th />}</tr></thead>
                  <tbody>
                    {d.outbound.map((j) => (
                      <tr key={j.id}>
                        <td className="text-xs"><DateTime value={j.createdAt} /></td>
                        <td className="font-mono text-xs">{String((j.payload as { type?: string }).type)}</td>
                        <td><StatusBadge status={j.status} /></td>
                        <td>{j.attempts}/{j.maxAttempts}</td>
                        <td className="max-w-xs text-xs text-slate-600">{j.status === "queued" && j.attempts > 0 && <>retry <DateTime value={j.runAt} /> · </>}{j.lastError}</td>
                        {manage && (
                          <td>
                            {j.status === "dead" && (
                              <ActionForm action={replayEventAction} inline submitLabel="Retry" submitClassName="btn btn-ghost px-2 py-1 text-xs">
                                <input type="hidden" name="id" value={j.id} />
                                <input type="hidden" name="kind" value="outbound" />
                                <input type="hidden" name="connectionId" value={c.id} />
                              </ActionForm>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          {isSim && manage && process.env.SIMULATORS_ENABLED === "true" && (
            <Card title="Simulator controls">
              <ActionForm action={simulatorAction} submitLabel="Send">
                <input type="hidden" name="connectionId" value={c.id} />
                <Field label="Scenario" htmlFor="scenario">
                  <select id="scenario" name="scenario" className="field">
                    {Object.entries(SCENARIOS).map(([k, label]) => (
                      <option key={k} value={k}>{label}</option>
                    ))}
                  </select>
                </Field>
              </ActionForm>
              <p className="mt-3 text-xs text-slate-500">Events go through the same signature, de-duplication and ordering checks as real partner traffic, then the background worker processes them.</p>
            </Card>
          )}
          {isSim && (
            <Card title="Simulator inbox (SES → partner)">
              {inbox.length === 0 ? (
                <p className="text-sm text-slate-500">No outbound deliveries received by the simulator since the server started.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {inbox.map((m) => (
                    <li key={m.receivedAt + m.id} className="rounded bg-slate-50 p-2">
                      <span className="font-mono">{m.type}</span> · {m.signatureValid ? <Badge tone="green">signature ok</Badge> : <Badge tone="red">bad signature</Badge>}
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-600">{JSON.stringify(m.data, null, 1)}</pre>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <Card title="Endpoint & credentials">
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-semibold">Inbound webhook URL</dt>
                <dd className="break-all font-mono text-xs">{appUrl}/api/v1/integrations/{c.id}/events</dd>
              </div>
              <div>
                <dt className="font-semibold">Partner endpoint (outbound)</dt>
                <dd className="break-all font-mono text-xs">{c.outboundUrl ?? "not configured"}</dd>
              </div>
            </dl>
            {manage && (
              <div className="mt-4 space-y-4">
                <ActionForm action={rotateSecretsAction} submitLabel="Rotate signing secrets" submitClassName="btn btn-ghost w-full" confirm="Rotate secrets? The partner must switch to the new secret immediately.">
                  <input type="hidden" name="id" value={c.id} />
                </ActionForm>
                <ActionForm action={connectionStatusAction} inline submitLabel="Set status" submitClassName="btn btn-ghost">
                  <input type="hidden" name="id" value={c.id} />
                  <label className="sr-only" htmlFor="cstatus">Connection status</label>
                  <select id="cstatus" name="status" defaultValue={c.status} className="field w-auto">
                    <option value="active">active</option>
                    <option value="paused">paused</option>
                    <option value="disabled">disabled</option>
                  </select>
                </ActionForm>
              </div>
            )}
          </Card>
          <Card title="API keys">
            {d.keys.length === 0 ? (
              <p className="text-sm text-slate-500">No keys issued.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {d.keys.map((k) => (
                  <li key={k.id} className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{k.name} <span className="font-mono text-xs text-slate-500">ses_{k.environment}_{k.prefix}_…</span></p>
                      <p className="text-xs text-slate-500">{k.scopes.join(", ")} · used <Ago value={k.lastUsedAt} /></p>
                    </div>
                    {k.revokedAt ? (
                      <Badge tone="red">revoked</Badge>
                    ) : (
                      manage && (
                        <ActionForm action={revokeApiKeyAction} inline submitLabel="Revoke" submitClassName="btn btn-ghost px-2 py-1 text-xs" confirm="Revoke this key?">
                          <input type="hidden" name="id" value={k.id} />
                          <input type="hidden" name="connectionId" value={c.id} />
                        </ActionForm>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
            {manage && (
              <ActionForm action={createApiKeyAction} submitLabel="Issue key" submitClassName="btn btn-ghost" className="mt-4 space-y-3">
                <input type="hidden" name="connectionId" value={c.id} />
                <Field label="Key name" htmlFor="kname">
                  <input id="kname" name="name" className="field" required minLength={3} />
                </Field>
                <fieldset>
                  <legend className="field-label">Scopes</legend>
                  {API_SCOPES.map((s) => (
                    <label key={s} className="mr-3 inline-flex items-center gap-1 text-sm"><input type="checkbox" name="scopes" value={s} /> {s}</label>
                  ))}
                </fieldset>
              </ActionForm>
            )}
          </Card>
          {d.priceApprovals.length > 0 && (
            <Card title="Price changes awaiting approval">
              <ul className="space-y-1 text-sm">
                {d.priceApprovals.map((a) => <li key={a.id}>{a.summary}</li>)}
              </ul>
              <Link href="/ops/approvals" className="mt-2 inline-block text-sm text-teal-700 hover:underline">Open approvals</Link>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
