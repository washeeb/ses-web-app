import Link from "next/link";
import { Logo } from "@/components/logo";
import { SiteHeader } from "@/components/site-header";
import { NavProgress } from "@/components/nav-progress";
import { Suspense } from "react";
import { getSessionState, homeFor } from "@/server/web/session";
import { getDb } from "@/server/db/client";
import { getSettings } from "@/server/modules/settings";
import { cartCount } from "@/server/modules/store";
import { readCart } from "@/server/web/cart";
import { products } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { WhatsAppButton, WhatsAppIcon, waLink } from "@/components/whatsapp";
import { VisitorAssistant } from "@/components/visitor-assistant";
import { publicAssistantAvailable } from "@/server/modules/ai";

const NAV = [
  { href: "/services", label: "Services" },
  { href: "/store", label: "Store" },
  { href: "/partners", label: "Partners" },
  { href: "/case-studies", label: "Case studies" },
  { href: "/help", label: "Help" },
  { href: "/contact", label: "Contact" },
];

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const db = getDb();
  const [session, settings, cart, [demo], assistant] = await Promise.all([
    getSessionState(),
    getSettings(db),
    readCart(),
    db.select({ id: products.id }).from(products).where(eq(products.isDemo, true)).limit(1),
    publicAssistantAvailable(db),
  ]);
  const whatsapp = waLink(settings.whatsappNumber, "Hello Synclytics, I would like to know more about your services.");
  const items = cartCount(cart);
  const account = session && !session.pending ? { href: homeFor(session.actor), label: "My workspace" } : { href: "/login", label: "Sign in" };
  return (
    <>
      <Suspense fallback={null}>
        <NavProgress />
      </Suspense>
      <SiteHeader
        logo={<Logo />}
        items={[...NAV, { href: "/store/cart", label: "Cart", badge: items }]}
        cta={<Link href={account.href} className="btn btn-primary">{account.label}</Link>}
      />
      <main id="main">{children}</main>
      <footer className="mt-16 bg-brand-900 text-slate-300">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
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
            <h2 className="text-sm font-semibold text-white">Contact</h2>
            <ul className="mt-2 space-y-1 text-sm">
              <li><Link href="/contact" className="hover:text-white">Send an enquiry or book a call</Link></li>
              <li><a href={`mailto:${settings.supportEmail}`} className="hover:text-white">{settings.supportEmail}</a></li>
              {settings.supportPhone && <li><a href={`tel:${settings.supportPhone.replace(/[^+\d]/g, "")}`} className="hover:text-white">{settings.supportPhone}</a></li>}
              {whatsapp && (
                <li>
                  <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-white">
                    <WhatsAppIcon className="h-4 w-4" /> WhatsApp<span className="sr-only"> (opens WhatsApp)</span>
                  </a>
                </li>
              )}
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">Platform</h2>
            <ul className="mt-2 space-y-1 text-sm">
              <li><Link href="/login" className="hover:text-white">Customer &amp; partner sign-in</Link></li>
              <li><Link href="/privacy" className="hover:text-white">Privacy</Link></li>
            </ul>
            {demo && <p className="mt-4 text-xs text-slate-400">Product listings and prices marked “demonstration” are sample content.</p>}
            {settings.dpcRegistrationNumber && <p className="mt-2 text-xs text-slate-400">Data Protection Commission registration no. {settings.dpcRegistrationNumber}</p>}
          </div>
        </div>
      </footer>
      {settings.whatsappNumber && <WhatsAppButton number={settings.whatsappNumber} text="Hello Synclytics, I would like to know more about your services." raised />}
      {assistant && <VisitorAssistant />}
    </>
  );
}
