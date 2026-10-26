"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Item = { href: string; label: string; badge?: number };

/**
 * Public site header: highlights the current section, gains a shadow once the page scrolls, and on phones opens a
 * menu panel that closes by itself after a choice, on Escape, or on a tap outside it.
 */
export function SiteHeader({ logo, items, cta, extras }: { logo: React.ReactNode; items: Item[]; cta?: React.ReactNode; extras?: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // A menu opened on one page is closed once the visitor lands on another.
  const isOpen = open && openedAt === pathname;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [isOpen]);

  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return (
    <header className={`sticky top-0 z-40 border-b bg-white/90 backdrop-blur transition-shadow duration-300 print:hidden ${scrolled ? "border-slate-200 shadow-md shadow-slate-900/5" : "border-transparent"}`}>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
        {logo}
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={`nav-link relative rounded-full px-3 py-2 text-sm font-medium transition-colors ${active(n.href) ? "text-teal-700" : "text-slate-700 hover:text-teal-700"}`}
            >
              {n.label}
              {!!n.badge && (
                <>
                  <span aria-hidden="true" className="ml-1 inline-grid h-5 min-w-5 place-items-center rounded-full bg-teal-700 px-1 text-xs font-semibold text-white">{n.badge}</span>
                  <span className="sr-only"> ({n.badge} {n.badge === 1 ? "item" : "items"})</span>
                </>
              )}
            </Link>
          ))}
          {extras && <div className="ml-2">{extras}</div>}
          {cta && <div className="ml-2">{cta}</div>}
        </nav>
        <button
          ref={button}
          type="button"
          className="btn btn-ghost md:hidden"
          aria-expanded={isOpen}
          aria-controls="mobile-menu"
          onClick={() => {
            setOpen(!isOpen);
            setOpenedAt(pathname);
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {isOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
          <span>{isOpen ? "Close" : "Menu"}</span>
        </button>
      </div>
      <div
        ref={panel}
        id="mobile-menu"
        hidden={!isOpen}
        className="menu-panel border-t border-slate-200 bg-white px-4 pb-4 pt-2 shadow-lg md:hidden"
      >
        <nav aria-label="Mobile">
          <ul className="grid gap-1">
            {items.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  onClick={() => setOpen(false)}
                  aria-current={active(n.href) ? "page" : undefined}
                  className={`flex items-center justify-between rounded-lg px-3 py-3 text-base font-medium ${active(n.href) ? "bg-teal-50 text-teal-800" : "text-slate-800 hover:bg-slate-50"}`}
                >
                  {n.label}
                  {!!n.badge && (
                    <>
                      <span aria-hidden="true" className="inline-grid h-6 min-w-6 place-items-center rounded-full bg-teal-700 px-1.5 text-xs font-semibold text-white">{n.badge}</span>
                      <span className="sr-only"> ({n.badge} {n.badge === 1 ? "item" : "items"})</span>
                    </>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {(cta || extras) && (
            <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-200 pt-3" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
              {extras}
              {cta}
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
