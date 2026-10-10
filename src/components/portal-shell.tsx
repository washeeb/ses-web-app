import Link from "next/link";
import type { Actor } from "@/server/authz/policy";
import { Logo } from "./logo";
import { logout } from "@/app/(auth)/actions";
import { NotificationBell } from "./notifications";

export function PortalShell({ actor, title, nav, children }: { actor: Actor; title: string; nav: { href: string; label: string }[]; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-4">
            <Logo href={nav[0]?.href ?? "/"} />
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{title}</span>
          </div>
          <nav aria-label={title} className="flex items-center gap-4 text-sm">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="font-medium text-slate-700 hover:text-teal-700">{n.label}</Link>
            ))}
            <NotificationBell actor={actor} href={`${nav[0]?.href ?? ""}/notifications`} />
            <span className="hidden text-slate-500 sm:inline">{actor.name}</span>
            <form action={logout}><button className="btn btn-ghost">Sign out</button></form>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
