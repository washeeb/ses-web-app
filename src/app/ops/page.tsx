import Link from "next/link";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { dashboardStats } from "@/server/modules/reports";
import { dpcStatus, getSettings } from "@/server/modules/settings";
import { can } from "@/server/authz/policy";
import { listConnections } from "@/server/modules/integrations/manage";
import { Ago, Card, Money, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { LiveRefresh } from "@/components/live-refresh";

export default async function OpsDashboard() {
  const actor = await requireActor("operator");
  const db = getDb();
  const [stats, connections, settings] = await Promise.all([dashboardStats(db, actor), can(actor, "integrations.read") ? listConnections(db, actor) : Promise.resolve([]), getSettings(db)]);
  const dpc = dpcStatus(settings);
  const dpcMessage =
    dpc.state === "missing" ? "Data Protection Commission registration has not been recorded yet."
    : dpc.state === "expired" ? "The Data Protection Commission certificate has expired."
    : dpc.state === "expiring" ? `The Data Protection Commission certificate expires in ${dpc.daysLeft} day(s).`
    : null;
  const tiles = [
    stats.newLeads !== null && { label: "New leads", value: stats.newLeads, href: "/ops/leads" },
    stats.quotesPendingApproval !== null && { label: "Quotes awaiting approval", value: stats.quotesPendingApproval, href: "/ops/quotes", tone: stats.quotesPendingApproval ? ("amber" as const) : undefined },
    stats.openQuotes !== null && { label: "Quotes with customers", value: stats.openQuotes, href: "/ops/quotes" },
    stats.pendingOrders !== null && { label: "Orders to confirm", value: stats.pendingOrders, href: "/ops/orders" },
    stats.wonValue30d !== null && { label: "Order value, last 30 days", value: <Money minor={stats.wonValue30d} />, href: "/ops/orders" },
    stats.pendingApprovals !== null && { label: "Pending approvals", value: stats.pendingApprovals, href: "/ops/approvals", tone: stats.pendingApprovals ? ("amber" as const) : undefined },
    stats.deadLetters !== null && { label: "Dead-lettered events", value: stats.deadLetters, href: "/ops/integrations", tone: stats.deadLetters ? ("red" as const) : undefined },
    stats.openTickets !== null && { label: "Open support tickets", value: stats.openTickets, href: "/ops/support" },
    stats.breachedTickets !== null && { label: "Tickets past SLA", value: stats.breachedTickets, href: "/ops/support?show=breached", tone: stats.breachedTickets ? ("red" as const) : undefined },
    stats.overdueInvoicesMinor !== null && { label: "Overdue receivables", value: <Money minor={stats.overdueInvoicesMinor} />, href: "/ops/invoices?show=overdue", tone: stats.overdueInvoicesMinor ? ("amber" as const) : undefined },
  ].filter(Boolean) as { label: string; value: React.ReactNode; href: string; tone?: "amber" | "red" }[];

  return (
    <>
      <PageHeader title={`Welcome, ${actor.name.split(" ")[0]}`} description="Your work across departments. Figures reflect only what your role permits." actions={<><LiveRefresh topics={["leads", "quotes", "orders", "approvals", "integrations", "tickets", "invoices"]} />{can(actor, "reports.read") && <Link href="/ops/reports" className="btn btn-ghost">Reports</Link>}</>} />
      {dpcMessage && can(actor, "settings.manage") && (
        <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">
          {dpcMessage} <Link href="/ops/admin/settings" className="font-semibold underline">Update company settings</Link>
        </p>
      )}
      {tiles.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((t) => (
            <Stat key={t.label} {...t} />
          ))}
        </div>
      ) : (
        <Card>
          <p className="text-sm text-slate-600">
            Nothing needs your attention right now. See <Link className="text-teal-700 hover:underline" href="/ops/departments">Departments</Link> for the modules available to your role.
          </p>
        </Card>
      )}
      {connections.length > 0 && (
        <Card title="Partner integration health" className="mt-6" actions={<Link href="/ops/integrations" className="text-sm text-teal-700 hover:underline">Details</Link>}>
          <ul className="divide-y divide-slate-100">
            {connections.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/ops/integrations/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                <span className="flex items-center gap-3">
                  <span className="text-slate-500">Last sync <Ago value={c.lastSyncAt} /></span>
                  <StatusBadge status={c.health.state} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
