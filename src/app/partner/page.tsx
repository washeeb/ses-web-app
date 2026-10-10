import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { partnerOverview } from "@/server/modules/integrations/manage";
import { AppError } from "@/server/lib/errors";
import { Ago, Badge, Card, DateTime, EmptyState, Money, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export default async function PartnerHome() {
  const actor = await requireActor("partner");
  const data = await partnerOverview(getDb(), actor).catch((e) => {
    if (e instanceof AppError) return null;
    throw e;
  });
  if (!data) return <EmptyState title="Your account has no partner access yet">Ask your partner administrator or SES to grant access.</EmptyState>;
  const simulated = data.connections.some((c) => c.mode === "simulator");
  return (
    <>
      <PageHeader
        title="Integration overview"
        description="What SES has received from your systems: mapped products, stock, fulfilment requests and event processing. Catalogue and stock updates come from your store via the integration API."
        actions={<LiveRefresh topics={["integrations", "orders", "stock"]} />}
      />
      {simulated && (
        <p className="mb-4 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-900">
          <strong>Simulated data.</strong> Your organisation&apos;s web application is not connected yet. Items below come from the SES integration simulator and are not your real products, prices or stock.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {data.connections.map((c) => (
          <Card key={c.id} title={c.name} actions={<><StatusBadge status={c.mode} /> <StatusBadge status={c.status} /></>}>
            <p className="text-sm">Last event received <Ago value={c.lastEventAt} /> · last processed <Ago value={c.lastSyncAt} /></p>
            <p className="text-xs text-slate-500">Stock older than {Math.round(c.staleAfterSeconds / 60)} minutes is treated as unconfirmed and cannot be sold.</p>
          </Card>
        ))}
        {data.connections.length === 0 && <EmptyState title="No integration connection yet" />}
      </div>

      <Card title="Mapped products" className="mt-6">
        {data.mappings.length === 0 ? (
          <EmptyState title="No products received yet" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Your SKU</th><th>Listed as</th><th className="text-right">Your cost</th><th className="text-right">Stock / held</th><th>Stock updated</th></tr></thead>
              <tbody>
                {data.mappings.map((m) => (
                  <tr key={m.partnerSku}>
                    <td className="font-mono text-xs">{m.partnerSku}</td>
                    <td>{m.productName} {m.listed ? <Badge tone="green">on sale</Badge> : <Badge>not listed</Badge>}</td>
                    <td className="text-right">{m.partnerCostMinor !== null ? <Money minor={m.partnerCostMinor} currency={m.partnerCurrency ?? "GHS"} /> : "—"}</td>
                    <td className="text-right">{m.onHand} / {m.reserved}</td>
                    <td className="text-xs"><Ago value={m.lastStockAt} /> {m.stockStale && <Badge tone="amber">stale</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="Fulfilment requests" className="mt-6">
        {data.fulfilment.length === 0 ? (
          <EmptyState title="No fulfilment requests" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Order</th><th>Your SKU</th><th className="text-right">Qty</th><th>Status</th><th>Placed</th></tr></thead>
              <tbody>
                {data.fulfilment.map((f) => (
                  <tr key={f.lineId}>
                    <td>{f.orderNumber} {f.orderStatus === "cancelled" && <Badge tone="red">cancelled</Badge>}</td>
                    <td className="font-mono text-xs">{f.partnerSku ?? "—"}</td>
                    <td className="text-right">{f.quantity}</td>
                    <td><StatusBadge status={f.fulfilmentStatus} /></td>
                    <td className="text-xs"><DateTime value={f.createdAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <Card title="Recent events from your systems" className="mt-6">
        {data.events.length === 0 ? (
          <EmptyState title="No events yet" />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {data.events.map((e) => (
              <li key={e.eventId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-mono text-xs">{e.type} · {e.eventId}</span>
                <span className="flex items-center gap-2"><StatusBadge status={e.status} /><span className="text-xs text-slate-500"><DateTime value={e.receivedAt} /></span></span>
                {e.lastError && <p className="w-full text-xs text-slate-500">{e.lastError}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
