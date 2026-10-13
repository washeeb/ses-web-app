"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

/** exact: highlight only on this very page (use for dashboards, whose path prefixes every other page). */
export type NavItem = { href: string; label: string; exact?: boolean };
export type NavGroup = { label: string | null; items: NavItem[] };

/** The item whose link is the longest match for the current path ("/admin/products/123" → "Products"). */
export function activeHref(pathname: string, items: NavItem[]) {
  let best: string | null = null;
  for (const { href: h, exact } of items) {
    const hit = pathname === h || (!exact && pathname.startsWith(h.endsWith("/") ? h : `${h}/`));
    if (hit && (!best || h.length > best.length)) best = h;
  }
  return best;
}

const STORE_KEY = "nav-open-groups";
const listeners = new Set<() => void>();
function readSaved(): string {
  try {
    return localStorage.getItem(STORE_KEY) ?? "{}";
  } catch {
    return "{}"; // storage unavailable: every group starts open
  }
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function save(value: Record<string, boolean>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
function parse(raw: string): Record<string, boolean> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * Grouped side menu. The current page is highlighted (aria-current="page") and its group is always open; other
 * groups start open and remember if the viewer collapses them. On small screens the menu folds behind a button.
 */
export function SideNav({ groups, label }: { groups: NavGroup[]; label: string }) {
  const pathname = usePathname() ?? "";
  const current = activeHref(pathname, groups.flatMap((g) => g.items));
  const open = parse(useSyncExternalStore(subscribe, readSaved, () => "{}"));
  // The small-screen menu closes by itself on navigation: it is open only for the page where it was opened.
  const [mobileOpenOn, setMobileOpenOn] = useState<string | null>(null);
  const mobileOpen = mobileOpenOn === pathname;
  const setMobileOpen = (fn: (v: boolean) => boolean) => setMobileOpenOn(fn(mobileOpen) ? pathname : null);
  const toggle = (key: string, value: boolean) => save({ ...open, [key]: value });
  const currentLabel = groups.flatMap((g) => g.items).find((i) => i.href === current)?.label;

  return (
    <nav aria-label={label} className="px-2 pb-3">
      <button
        type="button"
        className="mb-2 flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 lg:hidden"
        aria-expanded={mobileOpen}
        aria-controls="side-nav-groups"
        onClick={() => setMobileOpen((v) => !v)}
      >
        <span>Menu{currentLabel ? <span className="font-normal text-slate-600"> · {currentLabel}</span> : null}</span>
        <span aria-hidden="true">{mobileOpen ? "▴" : "▾"}</span>
      </button>
      <div id="side-nav-groups" className={`${mobileOpen ? "block" : "hidden"} space-y-1 lg:block`}>
        {groups.map((g) => {
          const key = g.label ?? "_";
          const hasCurrent = g.items.some((i) => i.href === current);
          const links = (
            <ul className="space-y-0.5">
              {g.items.map((n) => {
                const active = n.href === current;
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-md border-l-4 px-3 py-1.5 text-sm ${
                        active ? "border-teal-700 bg-teal-50 font-semibold text-teal-900" : "border-transparent font-medium text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          );
          if (!g.label) return <div key={key}>{links}</div>;
          return (
            <details
              key={key}
              open={hasCurrent || (open[key] ?? true)}
              onToggle={(e) => {
                const isOpen = (e.currentTarget as HTMLDetailsElement).open;
                if (!hasCurrent && isOpen !== (open[key] ?? true)) toggle(key, isOpen);
              }}
              className="group"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                {g.label}
                <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
              </summary>
              <div className="mt-0.5">{links}</div>
            </details>
          );
        })}
      </div>
    </nav>
  );
}

/** Horizontal menu for the portals, with the current section highlighted. */
export function TopNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname() ?? "";
  const current = activeHref(pathname, items);
  return (
    <>
      {items.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={n.href === current ? "page" : undefined}
          className={`border-b-2 py-1 font-medium ${n.href === current ? "border-teal-700 text-teal-800" : "border-transparent text-slate-700 hover:text-teal-700"}`}
        >
          {n.label}
        </Link>
      ))}
    </>
  );
}
