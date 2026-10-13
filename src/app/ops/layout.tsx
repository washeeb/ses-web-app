import Link from "next/link";
import { Logo } from "@/components/logo";
import { can } from "@/server/authz/policy";
import type { Permission } from "@/server/authz/permissions";
import { requireActor } from "@/server/web/session";
import { logout } from "../(auth)/actions";
import { NotificationBell } from "@/components/notifications";
import { SideNav } from "@/components/side-nav";

type Entry = { href: string; label: string; perm?: Permission | Permission[]; exact?: boolean };
/** Menu groups. An entry shows when the user holds any of its permissions; empty groups are hidden. */
const NAV: { label: string | null; items: Entry[] }[] = [
  { label: null, items: [{ href: "/ops", label: "Dashboard", exact: true }] },
  {
    label: "Sales",
    items: [
      { href: "/ops/leads", label: "Leads", perm: "leads.read" },
      { href: "/ops/quotes", label: "Quotations", perm: "quotes.read" },
      { href: "/ops/orders", label: "Orders", perm: "orders.read" },
      { href: "/ops/customers", label: "Customers", perm: "orders.read" },
    ],
  },
  {
    label: "Service delivery",
    items: [
      { href: "/ops/support", label: "Support", perm: "support.read" },
      { href: "/ops/subscriptions", label: "Subscriptions & contracts", perm: ["subscriptions.manage", "orders.read", "finance.read", "support.read"] },
      { href: "/ops/projects", label: "Projects", perm: "projects.read" },
      { href: "/ops/assets", label: "Assets", perm: ["assets.manage", "support.read", "orders.read"] },
      { href: "/ops/returns", label: "Returns & warranty", perm: "orders.read" },
      { href: "/ops/knowledge", label: "Knowledge base", perm: "kb.write" },
    ],
  },
  {
    label: "Catalogue & inventory",
    items: [
      { href: "/ops/catalogue", label: "Catalogue & stock", perm: "catalogue.read" },
      { href: "/ops/procurement", label: "Procurement", perm: "procurement.read" },
    ],
  },
  { label: "Finance", items: [{ href: "/ops/invoices", label: "Invoices", perm: "finance.read" }] },
  {
    label: "Reports",
    items: [
      { href: "/ops/reports", label: "Reports", perm: "reports.read" },
      { href: "/ops/exports", label: "Data exports", perm: "data.export" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/ops/approvals", label: "Approvals", perm: "approvals.read" },
      { href: "/ops/integrations", label: "Partner integrations", perm: "integrations.read" },
      { href: "/ops/departments", label: "Departments" },
      { href: "/ops/admin/users", label: "Users & access", perm: "users.read" },
      { href: "/ops/admin/settings", label: "Company settings", perm: "settings.manage" },
      { href: "/ops/audit", label: "Audit log", perm: "audit.read" },
    ],
  },
];

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("operator", "/ops");
  const allowed = (n: Entry) => !n.perm || (Array.isArray(n.perm) ? n.perm : [n.perm]).some((p) => can(actor, p));
  const groups = NAV.map((g) => ({ label: g.label, items: g.items.filter(allowed).map(({ href, label, exact }) => ({ href, label, exact })) })).filter((g) => g.items.length > 0);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr] print:block">
      <aside className="border-b border-slate-200 bg-white print:hidden lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-4 py-4">
          <Logo href="/ops" height={34} />
        </div>
        <SideNav groups={groups} label="Operations" />
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
