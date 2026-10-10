import type { getTicket } from "@/server/modules/tickets";
import { Badge, DateTime, type Tone } from "./ui";

type TicketView = Awaited<ReturnType<typeof getTicket>>;

const PRIORITY_TONE: Record<string, Tone> = { urgent: "red", high: "amber", normal: "blue", low: "gray" };

export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRIORITY_TONE[priority] ?? "gray"}>{priority}</Badge>;
}

/** Target time with breach/paused state. */
export function SlaDue({ due, breached, paused, done }: { due: Date; breached: boolean; paused?: boolean; done?: boolean }) {
  if (done) return <span className="text-slate-600">met</span>;
  if (paused) return <span className="text-slate-600">paused (waiting on customer)</span>;
  return (
    <span className={breached ? "font-semibold text-red-700" : ""}>
      <DateTime value={due} />
      {breached && <> · breached</>}
    </span>
  );
}

/** Conversation, oldest first. Internal notes only ever reach this component for staff. */
export function TicketThread({ ticket, staffOrgView }: { ticket: TicketView; staffOrgView: boolean }) {
  return (
    <ol className="space-y-4" aria-label="Conversation">
      {ticket.messages.map(({ m, authorName, authorOrgId }) => {
        const fromCustomer = authorOrgId === ticket.customerOrgId;
        return (
          <li
            key={m.id}
            className={`rounded-lg border p-4 ${m.internal ? "border-amber-200 bg-amber-50" : fromCustomer ? "border-slate-200 bg-white" : "border-teal-200 bg-teal-50"}`}
          >
            <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">{authorName ?? "System"}</span>
              {!fromCustomer && <span>{staffOrgView ? "SES" : "Synclytics support"}</span>}
              {m.internal && <Badge tone="amber">internal note</Badge>}
              <DateTime value={m.createdAt} />
            </p>
            <p className="mt-2 whitespace-pre-line text-sm text-slate-800">{m.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
