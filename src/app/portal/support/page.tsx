import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listTickets, type TicketFilter } from "@/server/modules/tickets";
import { Card, DateTime, EmptyState, PageHeader, StatusBadge, TableWrap } from "@/components/ui";
import { PriorityBadge } from "@/components/service-ui";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Support" };

export default async function PortalSupport({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const actor = await requireActor("customer");
  const filter: TicketFilter = (await searchParams).show === "all" ? "all" : "open";
  const rows = await listTickets(getDb(), actor, { filter });
  return (
    <>
      <PageHeader
        title="Support"
        description="Report a problem and follow it to resolution. We reply here and notify you."
        actions={
          <>
            <LiveRefresh topics={["tickets"]} />
            <Link href={filter === "all" ? "/portal/support" : "/portal/support?show=all"} className="btn btn-ghost">{filter === "all" ? "Open tickets only" : "Show all"}</Link>
            {can(actor, "customer.tickets.write", { organizationId: actor.organizationId }) && <Link href="/portal/support/new" className="btn btn-primary">Report a problem</Link>}
          </>
        }
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={filter === "open" ? "No open tickets" : "No tickets yet"} />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Ticket</th><th>Priority</th><th>Status</th><th>Raised</th></tr></thead>
              <tbody>
                {rows.map(({ t }) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/portal/support/${t.id}`} className="font-medium text-teal-700 hover:underline">{t.number}</Link>
                      <span className="block max-w-sm truncate text-xs text-slate-600">{t.subject}</span>
                    </td>
                    <td><PriorityBadge priority={t.priority} /></td>
                    <td><StatusBadge status={t.status} /></td>
                    <td><DateTime value={t.createdAt} /></td>
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
