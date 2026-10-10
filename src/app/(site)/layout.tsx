import Link from "next/link";
import { Logo } from "@/components/logo";
import { getSessionState, homeFor } from "@/server/web/session";
import { getDb } from "@/server/db/client";
import { getSettings } from "@/server/modules/settings";
import { cartCount } from "@/server/modules/store";
import { readCart } from "@/server/web/cart";

const NAV = [
  { href: "/services", label: "Services" },
  { href: "/store", label: "Store" },
  { href: "/partners", label: "Partners" },
  { href: "/case-studies", label: "Case studies" },
  { href: "/contact", label: "Contact" },
];

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [session, settings, cart] = await Promise.all([getSessionState(), getSettings(getDb()), readCart()]);
  const items = cartCount(cart);
  const cartLink = { href: "/store/cart", label: items ? `Cart (${items})` : "Cart" };
  const account = session && !session.pending ? { href: homeFor(session.actor), label: "My workspace" } : { href: "/login", label: "Sign in" };
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-sm font-medium text-slate-700 hover:text-teal-700">
                {n.label}
              </Link>
            ))}
            <Link href={cartLink.href} className="text-sm font-medium text-slate-700 hover:text-teal-700">
              {cartLink.label}
            </Link>
            <Link href={account.href} className="btn btn-primary">
              {account.label}
            </Link>
          </nav>
          <details className="relative md:hidden">
            <summary className="btn btn-ghost list-none" aria-label="Open menu">
              Menu
            </summary>
            <nav aria-label="Mobile" className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              {[...NAV, cartLink, account].map((n) => (
                <Link key={n.href} href={n.href} className="block rounded-md px-3 py-2 text-sm hover:bg-slate-50">
                  {n.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="mt-16 bg-brand-900 text-slate-300">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
          <div>
            <Logo variant="reverse" />
            <p className="mt-3 text-sm">Practical technology for businesses, institutions and partner companies. Accra, Ghana.</p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Explore</h2>
            <ul className="mt-2 space-y-1 text-sm">
              {NAV.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="hover:text-white">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Platform</h2>
            <ul className="mt-2 space-y-1 text-sm">
              <li><Link href="/login" className="hover:text-white">Customer &amp; partner sign-in</Link></li>
              <li><Link href="/privacy" className="hover:text-white">Privacy</Link></li>
            </ul>
            <p className="mt-4 text-xs text-slate-400">Product listings and prices marked “demonstration” are sample content.</p>
            {settings.dpcRegistrationNumber && <p className="mt-2 text-xs text-slate-400">Data Protection Commission registration no. {settings.dpcRegistrationNumber}</p>}
          </div>
        </div>
      </footer>
    </>
  );
}
