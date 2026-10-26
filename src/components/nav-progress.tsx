"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Thin progress bar at the top of the window while the next page loads. It starts the moment a visitor clicks a
 * link to another page on this site (or submits a search form) and completes when the new address is shown.
 * Purely visual: screen readers get the page's own heading and loading message instead.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timer = useRef<number | undefined>(undefined);
  const where = `${pathname}?${search.toString()}`;
  const last = useRef(where);

  useEffect(() => {
    const start = () => {
      window.clearTimeout(timer.current);
      setState("loading");
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page or #anchor
      start();
    };
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (!e.defaultPrevented && (form.method || "get").toLowerCase() === "get") start();
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
    };
  }, []);

  useEffect(() => {
    if (last.current === where) return;
    last.current = where;
    setState((s) => (s === "loading" ? "done" : s));
    timer.current = window.setTimeout(() => setState("idle"), 350);
  }, [where]);

  return <div aria-hidden="true" className={`nav-progress ${state}`} />;
}
