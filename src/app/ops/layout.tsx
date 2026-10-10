import Link from "next/link";
import { Logo } from "@/components/logo";
import { can } from "@/server/authz/policy";
import type { Permission } from "@/server/authz/permissions";
import { requireActor } from "@/server/web/session";
import { logout } from "../(auth)/actions";
import { NotificationBell } from "@/components/notifications";

const NAV: { href: string; label: string; perm?: Permission }[] = [
  { href: "/ops", label: "Dashboard" },
  { href: "/ops/leads", label: "Leads", perm: "leads.read" },
  { href: "/ops/quotes", label: "Quotations", perm: "quotes.read" },
  { href: "/ops/orders", label: "Orders", perm: "orders.read" },
  { href: "/ops/invoices", label: "Invoices", perm: "finance.read" },
  { href: "/ops/customers", label: "Customers", perm: "orders.read" },
  { href: "/ops/returns", label: "Returns & warranty", perm: "orders.read" },
  { href: "/ops/approvals", label: "Approvals", perm: "approvals.read" },
  { href: "/ops/catalogue", label: "Catalogue & stock", perm: "catalogue.read" },
  { href: "/ops/procurement", label: "Procurement", perm: "procurement.read" },
  { href: "/ops/integrations", label: "Partner integrations", perm: "integrations.read" },
  { href: "/ops/exports", label: "Data exports", perm: "data.export" },
  { href: "/ops/departments", label: "Departments" },
  { href: "/ops/admin/users", label: "Users & access", perm: "users.read" },
  { href: "/ops/admin/settings", label: "Company settings", perm: "settings.manage" },
  { href: "/ops/audit", label: "Audit log", perm: "audit.read" },
];

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("operator", "/ops");
  const items = NAV.filter((n) => !n.perm || can(actor, n.perm));
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr] print:block">
      <aside className="border-b border-slate-200 bg-white print:hidden lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-4 py-4">
          <Logo href="/ops" height={34} />
        </div>
        <nav aria-label="Operations" className="flex gap-1 overflow-x-auto px-2 pb-3 lg:flex-col lg:overflow-visible">
          {items.map((n) => (
            <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
              {n.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3 print:hidden">
          <p className="text-sm text-slate-600">
            Operations · <span className="font-medium text-slate-900">{actor.name}</span>
            {actor.mfaVerified && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800">MFA verified</span>}
          </p>
          <div className="flex items-center gap-3">
            <NotificationBell actor={actor} href="/ops/notifications" />
            <Link href="/" className="text-sm text-slate-600 hover:underline">Public site</Link>
            <form action={logout}>
              <button className="btn btn-ghost">Sign out</button>
            </form>
          </div>
        </header>
        <main id="main" className="min-w-0 px-4 py-8 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
