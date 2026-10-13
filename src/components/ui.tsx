import Link from "next/link";
import type { ReactNode } from "react";
import { formatMoney } from "@/server/lib/money";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          {title && <h2 className="text-base font-semibold text-slate-900">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const TONES = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-800 ring-blue-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  teal: "bg-teal-50 text-teal-800 ring-teal-200",
  purple: "bg-violet-50 text-violet-800 ring-violet-200",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  new: "blue", contacted: "purple", qualified: "teal", won: "green", lost: "gray",
  draft: "gray", pending_approval: "amber", approved: "teal", sent: "blue", accepted: "green", declined: "gray", rejected: "red", expired: "gray",
  pending: "amber", confirmed: "blue", fulfilled: "green", cancelled: "gray",
  received: "blue", processed: "green", stale_ignored: "gray", failed: "amber", dead: "red",
  queued: "blue", running: "purple", done: "green", superseded: "gray",
  active: "green", paused: "amber", disabled: "red", retired: "gray",
  healthy: "green", degraded: "amber", failing: "red", idle: "gray",
  in_stock: "green", low_stock: "amber", out_of_stock: "red", unconfirmed: "amber", not_tracked: "gray",
  not_started: "gray", requested: "blue", shipped: "purple", delivered: "green",
  simulator: "purple", production: "teal",
  in_transit: "purple", sold: "gray", written_off: "red", returned_to_supplier: "gray",
  partially_received: "amber", initialized: "blue", success: "green", amount_mismatch: "red", abandoned: "gray",
  issued: "blue", part_paid: "amber", paid: "green", unpaid: "amber", void: "gray", reversed: "gray", overdue: "red",
  ended: "gray", lapsed: "red", scheduled: "blue", open: "blue", pending_customer: "amber", resolved: "green", closed: "gray",
  planning: "purple", on_hold: "amber", completed: "green", todo: "gray", in_progress: "blue", awaiting_signoff: "amber", signed_off: "green", in_repair: "amber",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "gray"}>{status.replace(/_/g, " ")}</Badge>;
}

export function Money({ minor, currency = "GHS" }: { minor: number; currency?: string }) {
  return <span className="tabular-nums">{formatMoney(minor, currency)}</span>;
}

const dtf = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Accra" });
const df = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "Africa/Accra" });

export function DateTime({ value, dateOnly }: { value: Date | string | null | undefined; dateOnly?: boolean }) {
  if (!value) return <span className="text-slate-500">—</span>;
  const d = typeof value === "string" ? new Date(value) : value;
  return <time dateTime={d.toISOString()}>{(dateOnly ? df : dtf).format(d)}</time>;
}

export function Ago({ value }: { value: Date | null | undefined }) {
  if (!value) return <span className="text-slate-500">never</span>;
  // Server-rendered per request; LiveRefresh re-renders it when data changes.
  // eslint-disable-next-line react-hooks/purity
  const s = Math.max(0, Math.round((Date.now() - value.getTime()) / 1000));
  const text = s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
  return <time dateTime={value.toISOString()} title={dtf.format(value)}>{text}</time>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
      <p className="font-semibold text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function DemoNotice({ children }: { children?: ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="note">
      <strong>Demonstration data.</strong> {children ?? "Records shown here are sample content for evaluation, not real customers, prices or stock."}
    </p>
  );
}

export function Stat({ label, value, href, tone }: { label: string; value: ReactNode; href?: string; tone?: Tone }) {
  const body = (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${tone === "red" ? "border-red-200" : tone === "amber" ? "border-amber-200" : "border-slate-200"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl hover:ring-2 hover:ring-teal-200">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="-mx-5 overflow-x-auto">{children}</div>;
}
