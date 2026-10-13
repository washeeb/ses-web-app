import { getDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { authorize } from "@/server/authz/policy";
import { toCsv } from "@/server/modules/csv";
import { audit } from "@/server/modules/audit";
import { forecastReport, inventoryReport, parseRange, pipelineReport, productPerformance, salesReport, taxReport } from "@/server/modules/analytics";
import { getSessionState } from "@/server/web/session";

export const dynamic = "force-dynamic";

const money = (minor: number | null | undefined) => (minor === null || minor === undefined ? "" : (minor / 100).toFixed(2));
const day = (d: Date) => d.toISOString().slice(0, 10);

/** CSV of a report for the same period as on screen (?range= or ?from=&to=). Permission-checked and audited. */
export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const state = await getSessionState();
  if (!state || state.pending || state.actor.organizationType !== "operator") return new Response("Sign in required", { status: 401 });
  const { name } = await ctx.params;
  const sp = Object.fromEntries(new URL(req.url).searchParams) as { range?: string; from?: string; to?: string };
  const r = parseRange(sp);
  const db = getDb();
  const actor = state.actor;
  try {
    authorize(actor, "data.export");
    let header: string[];
    let rows: unknown[][];
    switch (name) {
      case "sales": {
        const s = await salesReport(db, actor, r);
        header = [`${s.unit}_starting`, "net_sales"];
        rows = s.series.map((p) => [day(p.at), money(p.value)]);
        break;
      }
      case "products": {
        const p = await productPerformance(db, actor, r);
        header = ["sku", "item", "category", "brand", "abc", "units", "sales", "cost", "margin", "margin_pct"];
        rows = p.rows.map((x) => [x.sku, x.name, x.categoryName, x.brandName, x.abc, x.qty, money(x.revenue), money(x.cost), money(x.margin), x.marginPct]);
        break;
      }
      case "inventory": {
        const x = await inventoryReport(db, actor, r);
        header = ["sku", "item", "category", "on_hand", "available", "value", "sold_per_day_90d", "days_of_cover", "last_sale"];
        const all = [...x.lowCover, ...x.dead.filter((d) => !x.lowCover.some((l) => l.variantId === d.variantId))];
        rows = all.map((i) => [i.sku, i.name, i.categoryName, i.onHand, i.available, money(i.valueMinor), i.dailyDemand, i.daysOfCover, i.lastSale ? day(i.lastSale) : ""]);
        break;
      }
      case "forecast": {
        const f = await forecastReport(db, actor);
        header = ["sku", "item", "weekly_sales_last_12_weeks", "forecast_per_week", "trend", "available", "on_order", "safety_stock", "reorder_point", "suggested_reorder_point", "suggested_order", "runs_out"];
        rows = f.rows.map((x) => [x.sku, x.name, x.weekly.join(" "), x.forecastWeekly, x.trend, x.available, x.onOrder, x.safetyStock, x.reorderPoint, x.suggestedReorderPoint, x.suggestedOrder, x.stockoutDate ? day(x.stockoutDate) : ""]);
        break;
      }
      case "tax": {
        const t = await taxReport(db, actor, r);
        header = ["month", "net_sales", ...t.codes.map((c) => c.code.toLowerCase()), "total_tax"];
        rows = t.months.map((m) => [m.month, money(m.net), ...t.codes.map((c) => money(m.taxes[c.code] ?? 0)), money(m.total)]);
        break;
      }
      case "pipeline": {
        const p = await pipelineReport(db, actor, r);
        header = ["group", "label", "leads", "won", "lost", "win_rate_pct"];
        rows = [...p.bySource.map((x) => ["source", x.label, x.leads, x.won, x.lost, x.winRate]), ...p.byInterest.map((x) => ["service", x.label, x.leads, x.won, x.lost, x.winRate])];
        break;
      }
      default:
        return new Response("Unknown report", { status: 404 });
    }
    await audit(db, { actor, action: "data.exported", targetType: "report", targetId: name, data: { rows: rows.length, from: day(r.from), to: day(new Date(r.to.getTime() - 1)) } });
    return new Response(toCsv(header, rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ses-report-${name}-${day(r.from)}-to-${day(new Date(r.to.getTime() - 1))}.csv"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
