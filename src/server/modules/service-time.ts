import type { SlaTargets } from "../db/schema";

/**
 * Service-level clock. Business hours are Monday–Friday 08:00–17:00 in Accra, which is UTC all year
 * (no daylight saving), so UTC arithmetic is exact. Public holidays are not excluded yet.
 */
export type Coverage = "business_hours" | "24x7";
export const COVERAGE_LABEL: Record<Coverage, string> = { business_hours: "Business hours (Mon–Fri 08:00–17:00)", "24x7": "24 × 7" };
export const PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

const OPEN = 8 * 60;
const CLOSE = 17 * 60;
const MINUTE = 60_000;

/** Applies to customers without an active service contract. */
export const DEFAULT_SLA: { coverage: Coverage; targets: SlaTargets } = {
  coverage: "business_hours",
  targets: {
    urgent: { responseMinutes: 60, resolutionMinutes: 8 * 60 },
    high: { responseMinutes: 4 * 60, resolutionMinutes: 2 * 9 * 60 },
    normal: { responseMinutes: 8 * 60, resolutionMinutes: 5 * 9 * 60 },
    low: { responseMinutes: 2 * 9 * 60, resolutionMinutes: 10 * 9 * 60 },
  },
};

const minuteOfDay = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const atMinute = (day: Date, minute: number) => new Date(startOfDay(day).getTime() + minute * MINUTE);

/** Moves a moment forward to the next instant inside business hours (unchanged if already inside). */
function nextOpen(d: Date): Date {
  let t = new Date(d);
  for (let i = 0; i < 14; i++) {
    if (!isWeekend(t) && minuteOfDay(t) < CLOSE) return minuteOfDay(t) < OPEN ? atMinute(t, OPEN) : t;
    t = atMinute(new Date(startOfDay(t).getTime() + 86_400_000), OPEN);
  }
  return t;
}

/** The moment `minutes` of covered service time after `start`. */
export function addServiceMinutes(start: Date, minutes: number, coverage: Coverage): Date {
  if (coverage === "24x7") return new Date(start.getTime() + minutes * MINUTE);
  let t = nextOpen(start);
  let remaining = minutes;
  for (let guard = 0; guard < 10_000; guard++) {
    const available = CLOSE - minuteOfDay(t);
    if (remaining <= available) return new Date(t.getTime() + remaining * MINUTE);
    remaining -= available;
    t = nextOpen(atMinute(t, CLOSE));
  }
  throw new Error("SLA target too long");
}

/** Covered service minutes between two moments (0 if `to` is not after `from`). */
export function serviceMinutesBetween(from: Date, to: Date, coverage: Coverage): number {
  if (to <= from) return 0;
  if (coverage === "24x7") return Math.round((to.getTime() - from.getTime()) / MINUTE);
  let total = 0;
  let t = nextOpen(from);
  for (let guard = 0; guard < 10_000 && t < to; guard++) {
    const dayClose = atMinute(t, CLOSE);
    const end = to < dayClose ? to : dayClose;
    total += Math.max(0, (end.getTime() - t.getTime()) / MINUTE);
    t = nextOpen(dayClose);
  }
  return Math.round(total);
}

export function dueDates(start: Date, priority: Priority, sla: { coverage: Coverage; targets: SlaTargets }) {
  const target = sla.targets[priority];
  return {
    responseDueAt: addServiceMinutes(start, target.responseMinutes, sla.coverage),
    resolutionDueAt: addServiceMinutes(start, target.resolutionMinutes, sla.coverage),
  };
}

/** "8 business hours", "2 business days", "4 hours" — for showing targets. */
export function describeTarget(minutes: number, coverage: Coverage) {
  if (coverage === "business_hours" && minutes >= 9 * 60 && minutes % (9 * 60) === 0) {
    const d = minutes / (9 * 60);
    return `${d} business day${d === 1 ? "" : "s"}`;
  }
  const h = minutes / 60;
  const unit = coverage === "business_hours" ? "business hour" : "hour";
  return Number.isInteger(h) ? `${h} ${unit}${h === 1 ? "" : "s"}` : `${minutes} minutes`;
}

/** Adds whole billing periods in UTC (month-end safe: 31 Jan + 1 month = 28/29 Feb). */
export function addPeriod(d: Date, period: string, count = 1): Date {
  const months = (period === "year" ? 12 : 1) * count;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}
