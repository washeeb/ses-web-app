import { formatMoney } from "@/server/lib/money";

/**
 * Horizontal bar chart as a plain list: screen readers read each label and value; the bars are decoration.
 * No chart library and no scripts, so it works under the strict Content-Security-Policy and prints cleanly.
 */
export function BarList({ data, money, label, empty = "No data for this period." }: { data: { label: string; value: number }[]; money?: boolean; label: string; empty?: string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  if (data.length === 0 || max === 0) return <p className="text-sm text-slate-500">{empty}</p>;
  const fmt = (v: number) => (money ? formatMoney(v) : v.toLocaleString("en-GH"));
  return (
    <ul className="space-y-2" aria-label={label}>
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-slate-700" title={d.label}>{d.label.replace(/_/g, " ")}</span>
          <span className="h-3 rounded bg-slate-100" aria-hidden>
            <span className="block h-3 rounded bg-teal-600" style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }} />
          </span>
          <span className="tabular-nums text-slate-900">{fmt(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}
