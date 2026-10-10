"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Keeps server-rendered pages current. Two modes, chosen at build time by NEXT_PUBLIC_LIVE_UPDATES:
 * - "sse" (default): server-sent events push a refresh within seconds of a change.
 * - "poll": refresh every 30 s while the tab is visible — for shared hosting (cPanel/Passenger),
 *   where long-lived connections tie up the limited application processes.
 * Either way, the data itself is always re-read through permission-checked server queries.
 */
const MODE = process.env.NEXT_PUBLIC_LIVE_UPDATES === "poll" ? "poll" : "sse";
const POLL_MS = 30_000;

export function LiveRefresh({ topics }: { topics: string[] }) {
  const router = useRouter();
  const [state, setState] = useState<"connecting" | "live" | "offline" | "polling">(MODE === "poll" ? "polling" : "connecting");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = topics.join(",");

  useEffect(() => {
    if (MODE === "poll") {
      const id = setInterval(() => {
        if (document.visibilityState === "visible") router.refresh();
      }, POLL_MS);
      return () => clearInterval(id);
    }
    const es = new EventSource(`/api/events?topics=${encodeURIComponent(key)}`);
    es.onopen = () => setState("live");
    es.onerror = () => setState("offline"); // EventSource reconnects automatically
    es.onmessage = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 400);
    };
    return () => {
      es.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, router]);

  const label =
    state === "live" ? "Live updates on" : state === "offline" ? "Live updates reconnecting…" : state === "polling" ? "Auto-refreshes every 30 s" : "Connecting…";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600" aria-live="polite">
      <span className={`h-2 w-2 rounded-full ${state === "live" || state === "polling" ? "bg-emerald-500" : state === "offline" ? "bg-amber-500" : "bg-slate-300"}`} aria-hidden />
      {label}
    </span>
  );
}
