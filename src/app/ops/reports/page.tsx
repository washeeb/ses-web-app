import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getDb } from "@/server/db/client";
import { requireActor } from "@/server/web/session";
import { can } from "@/server/authz/policy";
import { departmentReports } from "@/server/modules/reports";
import { aiAvailable, latestReportSummary } from "@/server/modules/ai";
import { ActionForm } from "@/components/action-form";
import { BarList } from "@/components/bar-list";
import { Card, DateTime, EmptyState, Money, PageHeader, Stat } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { summariseAction } from "./actions";

export const metadata: Metadata = { title: "Reports" };

const RANGES = [30, 90, 365];

function Section({ id, title, days, exportKind, canExport, ai, children }: { id: string; title: string; days: number; exportKind?: string; canExport: boolean; ai: { on: boolean; summary: { text: string; at: Date; model: string } | null }; children: ReactNode }) {
  return (
    <Card
      title={title}
      className="break-inside-avoid"
      actions={
        <span className="flex flex-wrap items-center gap-2 print:hidden">
          {canExport && exportKind && <a href={`/api/exports/${exportKind}`} className="text-sm text-teal-700 underline">Download CSV<span className="sr-only"> for {title}</span></a>}
          {ai.on && (
            <ActionForm action={summariseAction} inline submitLabel={<>Summarise with AI<span className="sr-only">: {title}</span></>} submitClassName="btn btn-ghost">
              <input type="hidden" name="section" value={id} />
              <input type="hidden" name="days" value={days} />
            </ActionForm>
          )}
        </span>
      }
    >
      {ai.summary && (
        <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-violet-800">AI summary — check against the figures below</p>
          <p className="whitespace-pre-line text-slate-800">{ai.summary.text}</p>
          <p className="mt-1 text-xs text-slate-600">Generated <DateTime value={ai.summary.at} /> by {ai.summary.model}</p>
        </div>
      )}
      {children}
    </Card>
  );
}

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const actor = await requireActor("operator");
  if (!can(actor, "reports.read")) return <EmptyState title="You can't open this page">Reports need the reports permission (managers, finance, executives, auditors).</EmptyState>;
  const d = Number((await searchParams).days);
  const days = RANGES.includes(d) ? d : 30;
  const db = getDb();
  const [r, aiOn] = await Promise.all([departmentReports(db, actor, days), aiAvailable(db, actor)]);
  const summaries = Object.fromEntries(
    await Promise.all(["sales", "finance", "support", "subscriptions", "projects", "operations"].map(async (k) => [k, aiOn ? await latestReportSummary(db, actor, k) : null] as const)),
  );
  const ai = (k: string) => ({ on: aiOn, summary: summaries[k] ?? null });
  const exp = can(actor, "data.export");
  return (
    <>
      <PageHeader
        title="Reports"
        description="Department figures for the selected period. Each section appears only if your role can see the underlying data. Monthly trends cover the last 12 months."
        actions={<PrintButton label="Print" />}
      />
      <nav aria-label="Report period" className="mb-6 flex flex-wrap gap-2 print:hidden">
        {RANGES.map((n) => (
          <Link key={n} href={`/ops/reports?days=${n}`} aria-current={n === days ? "page" : undefined} className={`rounded-full px-3 py-1 text-sm font-medium ${n === days ? "bg-brand-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}>
            Last {n === 365 ? "12 months" : `${n} days`}
          </Link>
        ))}
      </nav>
      <div className="grid gap-6 xl:grid-cols-2">
        {r.sales && (
          <Section id="sales" title="Sales" days={days} exportKind="orders" canExport={exp} ai={ai("sales")}>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <Stat label="Quotation win rate" value={pct(r.sales.conversionPct)} />
              <Stat label="Leads in period" value={r.sales.leadsByStatus.reduce((a, b) => a + b.value, 0)} />
            </div>
            <h3 className="mb-2 text-sm font-semibold">Order value by month</h3>
            <BarList data={r.sales.orderValueByMonth} money label="Order value by month" />
            <h3 className="mb-2 mt-5 text-sm font-semibold">Top items in period</h3>
            <BarList data={r.sales.topProducts} money label="Top items by value" />
            <h3 className="mb-2 mt-5 text-sm font-semibold">Quotations by outcome</h3>
            <BarList data={r.sales.quoteOutcomes} label="Quotations by status" />
          </Section>
        )}
        {r.finance && (
          <Section id="finance" title="Finance" days={days} exportKind="invoices" canExport={exp} ai={ai("finance")}>
            <h3 className="mb-2 text-sm font-semibold">Receivables ageing (today)</h3>
            <BarList data={r.finance.ageing} money label="Receivables by age" empty="Nothing outstanding." />
            <h3 className="mb-2 mt-5 text-sm font-semibold">Invoiced by month</h3>
            <BarList data={r.finance.invoicedByMonth} money label="Invoiced by month" />
            <h3 className="mb-2 mt-5 text-sm font-semibold">Collected by month (live payments)</h3>
            <BarList data={r.finance.collectedByMonth} money label="Collected by month" />
            <h3 className="mb-2 mt-5 text-sm font-semibold">Payments in period by method</h3>
            <BarList data={r.finance.paymentsByMethod} money label="Payments by method" />
          </Section>
        )}
        {r.support && (
          <Section id="support" title="Support" days={days} exportKind="tickets" canExport={exp} ai={ai("support")}>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <Stat label="Tickets opened" value={r.support.opened} />
              <Stat label="Resolved" value={r.support.resolved} />
              <Stat label="First response on time" value={pct(r.support.responseMetPct)} tone={r.support.responseMetPct !== null && r.support.responseMetPct < 90 ? "amber" : undefined} />
              <Stat label="Resolved on time" value={pct(r.support.resolutionMetPct)} tone={r.support.resolutionMetPct !== null && r.support.resolutionMetPct < 90 ? "amber" : undefined} />
            </div>
            <h3 className="mb-2 text-sm font-semibold">Open tickets by priority</h3>
            <BarList data={r.support.openByPriority} label="Open tickets by priority" empty="No open tickets." />
            <h3 className="mb-2 mt-5 text-sm font-semibold">Tickets in period by area</h3>
            <BarList data={r.support.byCategory} label="Tickets by category" />
          </Section>
        )}
        {r.subscriptions && (
          <Section id="subscriptions" title="Recurring revenue" days={days} exportKind="subscriptions" canExport={exp} ai={ai("subscriptions")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Stat label="Monthly recurring revenue (excl. taxes)" value={<Money minor={r.subscriptions.mrrMinor} />} />
              <Stat label="Active subscriptions" value={r.subscriptions.active} />
              <Stat label="Renewals due in 30 days" value={r.subscriptions.renewalsDue30d} />
              <Stat label="Lapsed in period" value={r.subscriptions.lapsed} tone={r.subscriptions.lapsed ? "amber" : undefined} />
            </div>
          </Section>
        )}
        {r.projects && (
          <Section id="projects" title="Projects" days={days} exportKind="projects" canExport={exp} ai={ai("projects")}>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <Stat label="Milestones awaiting sign-off" value={r.projects.awaitingSignoff} />
              <Stat label="Overdue tasks" value={r.projects.overdueTasks} tone={r.projects.overdueTasks ? "amber" : undefined} />
            </div>
            <BarList data={r.projects.byStatus} label="Projects by status" />
          </Section>
        )}
        {r.operations && (
          <Section id="operations" title="Operations" days={days} exportKind="stock" canExport={exp && can(actor, "inventory.read")} ai={ai("operations")}>
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              {r.operations.awaitingFulfilment !== null && <Stat label="Orders awaiting delivery" value={r.operations.awaitingFulfilment} />}
              {r.operations.lowStock !== null && <Stat label="Items low on stock" value={r.operations.lowStock} tone={r.operations.lowStock ? "amber" : undefined} />}
            </div>
            {r.operations.poSpendBySupplier && (
              <>
                <h3 className="mb-2 text-sm font-semibold">Purchase spend by supplier</h3>
                <BarList data={r.operations.poSpendBySupplier} money label="Purchase spend by supplier" />
              </>
            )}
            {r.operations.returnsByKind && (
              <>
                <h3 className="mb-2 mt-5 text-sm font-semibold">Returns and warranty claims</h3>
                <BarList data={r.operations.returnsByKind} label="Returns by kind" />
              </>
            )}
          </Section>
        )}
      </div>
      {aiOn && <p className="mt-6 text-xs text-slate-600">AI summaries only receive the aggregated figures shown on this page — no names, contacts or individual records.</p>}
    </>
  );
}
