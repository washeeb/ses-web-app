import type { Availability } from "@/server/modules/inventory";
import { Ago, Badge } from "./ui";

const LABEL: Record<Availability["status"], string> = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Out of stock",
  unconfirmed: "Availability to be confirmed",
  not_tracked: "Available to order",
};

export function AvailabilityBadge({ a, showCount }: { a: Availability; showCount?: boolean }) {
  const tone = a.status === "in_stock" || a.status === "not_tracked" ? "green" : a.status === "low_stock" || a.status === "unconfirmed" ? "amber" : "red";
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge tone={tone}>
        {LABEL[a.status]}
        {showCount && (a.status === "in_stock" || a.status === "low_stock") ? ` · ${a.available}` : ""}
      </Badge>
      {a.lastSyncAt && (
        <span className={`text-xs ${a.stale ? "text-amber-700" : "text-slate-500"}`}>
          Partner stock updated <Ago value={a.lastSyncAt} />
          {a.stale ? " (stale)" : ""}
        </span>
      )}
    </span>
  );
}
