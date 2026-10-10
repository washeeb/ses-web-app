import Link from "next/link";
import type { Metadata } from "next";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { listSubscriptionCustomers } from "@/server/modules/subscriptions";
import { TICKET_CATEGORIES } from "@/server/modules/tickets";
import { PRIORITIES } from "@/server/modules/service-time";
import { ActionForm } from "@/components/action-form";
import { Card, EmptyState, Field, PageHeader } from "@/components/ui";
import { createTicketAction } from "../../services-actions";

export const metadata: Metadata = { title: "New ticket" };

export default async function NewTicketPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "support.write")) return <EmptyState title="You can't open this page" />;
  const sp = await searchParams;
  const customers = await listSubscriptionCustomers(getDb());
  return (
    <>
      <Link href="/ops/support" className="text-sm text-teal-700 hover:underline">← Support</Link>
      <div className="mt-4"><PageHeader title="New ticket" description="For problems reported by phone or e-mail. Customers can also raise tickets themselves in their portal." /></div>
      <Card>
        <ActionForm action={createTicketAction} submitLabel="Create ticket">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Customer" htmlFor="customerOrgId">
              <select id="customerOrgId" name="customerOrgId" className="field" required defaultValue={sp.customer ?? ""}>
                <option value="" disabled>Choose…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Priority" htmlFor="priority">
              <select id="priority" name="priority" className="field" defaultValue="normal">
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Category" htmlFor="category">
              <select id="category" name="category" className="field" defaultValue="general">
                {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Subject" htmlFor="subject"><input id="subject" name="subject" className="field" required minLength={5} maxLength={160} /></Field>
          <Field label="Description" htmlFor="description"><textarea id="description" name="description" rows={6} className="field" required minLength={10} maxLength={8000} /></Field>
        </ActionForm>
      </Card>
    </>
  );
}
