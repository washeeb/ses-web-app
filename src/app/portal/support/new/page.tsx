import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listAssets } from "@/server/modules/assets";
import { slaFor } from "@/server/modules/subscriptions";
import { TICKET_CATEGORIES } from "@/server/modules/tickets";
import { describeTarget, PRIORITIES } from "@/server/modules/service-time";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { raiseTicketAction } from "../../services-actions";

export const metadata: Metadata = { title: "Report a problem" };

const PRIORITY_HELP: Record<string, string> = {
  urgent: "Urgent — business stopped (e.g. whole site offline)",
  high: "High — many people affected or a key system degraded",
  normal: "Normal — one person or a workaround exists",
  low: "Low — question or minor issue",
};

export default async function NewPortalTicket({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const actor = await requireActor("customer");
  if (!can(actor, "customer.tickets.write", { organizationId: actor.organizationId })) {
    return <EmptyState title="Your account cannot raise tickets">Ask your organisation&apos;s administrator.</EmptyState>;
  }
  const db = getDb();
  const sp = await searchParams;
  const [sla, equipment] = await Promise.all([
    slaFor(db, actor.organizationId),
    can(actor, "customer.assets.read", { organizationId: actor.organizationId }) ? listAssets(db, actor) : Promise.resolve([]),
  ]);
  return (
    <>
      <Link href="/portal/support" className="text-sm text-teal-700 hover:underline">← Support</Link>
      <div className="mt-4"><PageHeader title="Report a problem" description={`Our first response for urgent problems: within ${describeTarget(sla.targets.urgent.responseMinutes, sla.coverage)}${sla.contractId ? " under your service contract" : ""}.`} /></div>
      <Card>
        <ActionForm action={raiseTicketAction} submitLabel="Send to support">
          <Field label="Subject" htmlFor="subject"><input id="subject" name="subject" className="field" required minLength={5} maxLength={160} placeholder="Short summary, e.g. “Printer on 2nd floor not printing”" /></Field>
          <Field label="What is happening?" htmlFor="description" hint="When it started, who is affected, any error messages.">
            <textarea id="description" name="description" rows={6} className="field" required minLength={10} maxLength={8000} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="How serious is it?" htmlFor="priority">
              <select id="priority" name="priority" className="field" defaultValue="normal">
                {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_HELP[p]}</option>)}
              </select>
            </Field>
            <Field label="Area" htmlFor="category">
              <select id="category" name="category" className="field" defaultValue="general">
                {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Equipment (optional)" htmlFor="assetId">
              <select id="assetId" name="assetId" className="field" defaultValue={sp.asset ?? ""}>
                <option value="">Not specific</option>
                {equipment.map(({ a }) => <option key={a.id} value={a.id}>{a.tag} — {a.name}{a.serialNumber ? ` (${a.serialNumber})` : ""}</option>)}
              </select>
            </Field>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
