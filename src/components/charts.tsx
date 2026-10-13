import Link from "next/link";
import type { ReactNode } from "react";
import { formatMoney } from "@/server/lib/money";

/**
 * Server-rendered SVG charts: no chart library, no scripts (works under the strict CSP and prints cleanly).
 * Each chart has a text summary for screen readers and a "Show data" table.
 */

type Point = { at: Date; value: number };
const fmtValue = (v: number, money: boolean) => (money ? formatMoney(v) : v.toLocaleString("en-GH"));
const fmtDate = (d: Date, unit: "day" | "week" | "month") =>
  unit === "month" ? d.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Nice round axis maximum (1, 2, 2.5, 5 × 10ⁿ). */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

export function LineChart({ series, unit, money = false, label }: { series: Point[]; unit: "day" | "week" | "month"; money?: boolean; label: string }) {
  const W = 640;
  const H = 220;
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  const max = niceMax(Math.max(0, ...series.map((s) => s.value)));
  const x = (i: number) => pad.l + (series.length <= 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (series.length - 1));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const line = series.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(s.value).toFixed(1)}`).join(" ");
  const area = series.length ? `${line} L${x(series.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z` : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.max(1, Math.ceil(series.length / 7));
  const total = series.reduce((a, s) => a + s.value, 0);
  const peak = series.reduce((a, s) => (s.value > a.value ? s : a), series[0] ?? { at: new Date(), value: 0 });
  const axisLabel = (v: number) => (money ? (v / 100 >= 1000 ? `${(v / 100_000).toFixed(v / 100_000 >= 10 ? 0 : 1)}k` : (v / 100).toFixed(0)) : v.toLocaleString("en-GH"));
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${label}: total ${fmtValue(total, money)}${series.length ? `, highest ${fmtValue(peak.value, money)} on ${fmtDate(peak.at, unit)}` : ""}.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#475569">{axisLabel(t)}</text>
          </g>
        ))}
        {area && <path d={area} fill="currentColor" className="text-teal-600" opacity="0.12" />}
        {line && <path d={line} fill="none" stroke="currentColor" className="text-teal-700" strokeWidth="2" strokeLinejoin="round" />}
        {series.map((s, i) => (
          <g key={s.at.toISOString()}>
            <circle cx={x(i)} cy={y(s.value)} r={series.length > 40 ? 1.5 : 3} fill="currentColor" className="text-teal-700">
              <title>{`${fmtDate(s.at, unit)}: ${fmtValue(s.value, money)}`}</title>
            </circle>
            {i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#475569">{fmtDate(s.at, unit)}</text>}
          </g>
        ))}
      </svg>
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-teal-700">Show data</summary>
        <table className="mt-2 w-full max-w-sm">
          <caption className="sr-only">{label}</caption>
          <thead><tr><th className="text-left">{unit === "day" ? "Day" : unit === "week" ? "Week of" : "Month"}</th><th className="text-right">Value</th></tr></thead>
          <tbody>{series.map((s) => <tr key={s.at.toISOString()}><td>{fmtDate(s.at, unit)}</td><td className="text-right tabular-nums">{fmtValue(s.value, money)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

/** Tiny trend line for tables (decorative; the numbers sit next to it). */
export function Sparkline({ values, width = 96, height = 24 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i * width) / Math.max(1, values.length - 1)).toFixed(1)},${(height - 2 - ((height - 4) * v) / max).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" className="text-teal-700">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** A headline figure with its change against the previous period. */
export function Kpi({ label, value, change, invert = false, hint }: { label: string; value: ReactNode; change?: number | null; invert?: boolean; hint?: string }) {
  const good = change === undefined || change === null ? null : invert ? change < 0 : change > 0;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
      {change !== undefined && (
        <p className={`mt-1 text-xs ${change === null || change === 0 ? "text-slate-600" : good ? "text-emerald-700" : "text-red-700"}`}>
          {change === null ? "new this period" : `${change > 0 ? "▲" : change < 0 ? "▼" : "■"} ${Math.abs(change)}% vs previous period`}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const PRESET_OPTIONS: [string, string][] = [
  ["7d", "Last 7 days"],
  ["30d", "Last 30 days"],
  ["90d", "Last 90 days"],
  ["mtd", "This month"],
  ["lm", "Last month"],
  ["qtd", "This quarter"],
  ["ytd", "This year"],
  ["12m", "Last 12 months"],
];

/** Period picker (plain GET form, so the address can be bookmarked and shared). */
export function RangePicker({ sp, csvHref }: { sp: { range?: string; from?: string; to?: string }; csvHref?: string }) {
  return (
    <form className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden" aria-label="Report period">
      <label className="text-sm">
        <span className="block font-medium text-slate-800">Period</span>
        <select name="range" className="field mt-1" defaultValue={sp.from && sp.to ? "" : (sp.range ?? "30d")}>
          {PRESET_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          <option value="">Custom dates →</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="block font-medium text-slate-800">From</span>
        <input type="date" name="from" className="field mt-1" defaultValue={sp.from} />
      </label>
      <label className="text-sm">
        <span className="block font-medium text-slate-800">To</span>
        <input type="date" name="to" className="field mt-1" defaultValue={sp.to} />
      </label>
      <button className="btn btn-primary" type="submit">Show</button>
      {csvHref && <a className="btn btn-ghost" href={csvHref} download>Export CSV</a>}
      <Link href="?" className="ml-auto text-sm text-teal-700 underline">Reset</Link>
    </form>
  );
}
