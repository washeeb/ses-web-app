import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { LEVEL_LABEL, listTickets, type TicketFilter } from "@/server/modules/tickets";
import { Card, EmptyState, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { PriorityBadge, SlaDue } from "@/components/service-ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Support" };

const FILTERS: { key: TicketFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "mine", label: "Assigned to me" },
  { key: "breached", label: "SLA breached" },
  { key: "resolved", label: "Resolved & closed" },
  { key: "all", label: "All" },
];

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "support.read")) return <EmptyState title="You can't open this page">Support tickets need support access.</EmptyState>;
  const sp = await searchParams;
  const filter = FILTERS.find((f) => f.key === sp.show)?.key ?? "open";
  const rows = await listTickets(getDb(), actor, { filter });
  return (
    <>
      <PageHeader
        title="Support"
        description="Tickets from customers and staff, ordered by resolution deadline. Response and resolution targets come from each customer's service contract, or the standard business-hours SLA."
        actions={
          <>
            <LiveRefresh topics={["tickets"]} />
            {can(actor, "support.write") && <Link href="/ops/support/new" className="btn btn-primary">New ticket</Link>}
          </>
        }
      />
      <nav aria-label="Ticket filters" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/ops/support?show=${f.key}`} aria-current={f.key === filter ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm font-medium ${f.key === filter ? "bg-brand-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}>
            {f.label}
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No tickets here" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Ticket</th><th>Customer</th><th>Priority</th><th>Status</th><th>Line</th><th>Resolve by</th><th>Assignee</th></tr>
              </thead>
              <tbody>
                {rows.map(({ t, customerName, assigneeName }) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/ops/support/${t.id}`} className="font-medium text-teal-700 hover:underline">{t.number}</Link>
                      <span className="block max-w-xs truncate text-xs text-slate-600">{t.subject}</span>
                    </td>
                    <td>{customerName}</td>
                    <td><PriorityBadge priority={t.priority} /></td>
                    <td><StatusBadge status={t.status} /></td>
                    <td className="text-xs">{LEVEL_LABEL[t.level]}</td>
                    <td className="text-xs"><SlaDue due={t.resolutionDueAt} breached={t.resolutionBreached} paused={!!t.pausedAt} done={["resolved", "closed"].includes(t.status)} /></td>
                    <td className="text-xs">{assigneeName ?? <span className="text-slate-500">unassigned</span>}</td>
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
