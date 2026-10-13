import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { approvalRequests, invoices, mailOutbox, productVariants } from "@/server/db/schema";
import { decideApproval } from "@/server/modules/approvals";
import { buckets, forecastReport, holtForecast, inventoryReport, parseRange, paymentsReport, pipelineReport, productPerformance, receivablesAging, salesReport, sendWeeklyDigest, taxReport } from "@/server/modules/analytics";
import { receiveStock } from "@/server/modules/inventory";
import { acceptQuote, confirmOrder, createQuote, fulfilOrder, sendQuote, submitQuote } from "@/server/modules/sales";
import { recordManualPayment } from "@/server/modules/invoices";
import { updateSettings } from "@/server/modules/settings";

let db: DB;
let close: () => Promise<void>;
let orgs: Awaited<ReturnType<typeof setupDb>>["organizations"];
beforeAll(async () => ({ db, close, organizations: orgs } = await setupDb()));
afterAll(async () => close());
const as = (email: string) => actorFor(db, email, true);
const variant = async (sku: string) => (await db.select().from(productVariants).where(eq(productVariants.sku, sku)))[0]!;

describe("periods and forecast maths", () => {
  it("resolve presets with an equal previous period; Holt follows a trend", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    const r = parseRange({ range: "7d" }, now);
    expect(r.prevTo.getTime()).toBe(r.from.getTime());
    expect(buckets(r)).toHaveLength(7);
    expect(parseRange({ range: "lm" }, now).from.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(holtForecast([2, 4, 6, 8]).next).toBeGreaterThan(8);
    expect(holtForecast([0, 0, 0]).next).toBe(0);
  });
});

describe("reports", () => {
  it("add up sales, margin at average cost, taxes, payments and receivables", async () => {
    const exec = await as("exec@ses.demo");
    const wh = await as("warehouse@ses.demo");
    const sales = await as("sales@ses.demo");
    const srv = await variant("SES-SRV1U-STD");
    await receiveStock(db, wh, { variantId: srv.id, quantity: 2, unitCostMinor: 3_500_000 });
    const r = parseRange({ range: "7d" });
    const before = await salesReport(db, exec, r);
    const q = await createQuote(db, sales, { customerOrgId: orgs.custA.id, discountBp: 0, lines: [{ variantId: srv.id, quantity: 1 }] });
    await submitQuote(db, sales, q.id);
    // Large quotations need a second person to approve them first.
    const [pending] = await db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, q.id));
    if (pending?.status === "pending") await decideApproval(db, exec, pending.id, true, "OK");
    await sendQuote(db, sales, q.id);
    const order = await acceptQuote(db, await as("buyer.admin@customer-a.demo"), q.id);
    await confirmOrder(db, wh, order.id);
    await fulfilOrder(db, wh, order.id);
    const after = await salesReport(db, exec, r);
    expect(after.kpis.invoices.value - before.kpis.invoices.value).toBe(1);
    expect(after.kpis.net.value - before.kpis.net.value).toBe(srv.priceMinor);
    const cost = (await variant("SES-SRV1U-STD")).costMinor!;
    expect(after.kpis.margin.value - before.kpis.margin.value).toBe(srv.priceMinor - cost);
    const perf = (await productPerformance(db, exec, r)).rows.find((x) => x.sku === "SES-SRV1U-STD")!;
    expect(perf).toMatchObject({ qty: 1, revenue: srv.priceMinor, cost });
    expect((await taxReport(db, exec, r)).totals.byCode.VAT).toBeGreaterThan(0);
    const [inv] = await db.select().from(invoices).where(eq(invoices.orderId, order.id));
    await recordManualPayment(db, await as("finance@ses.demo"), inv!.id, { amountMinor: 100_000, method: "bank_transfer", externalReference: "TRF-1", paidOn: new Date().toISOString().slice(0, 10), note: "" });
    expect((await paymentsReport(db, exec, r)).find((p) => p.label === "Bank transfer")!.value).toBeGreaterThanOrEqual(100_000);
    expect((await receivablesAging(db, exec)).invoices.find((i) => i.number === inv!.number)!.balance).toBe(inv!.totalMinor - 100_000);
    await expect(taxReport(db, wh, r)).rejects.toThrow();
  });

  it("value SES stock, forecast it and summarise leads", async () => {
    const exec = await as("exec@ses.demo");
    const x = await inventoryReport(db, exec, parseRange({ range: "30d" }));
    expect(x.value).toBeGreaterThan(0);
    expect(x.byCategory.reduce((a, c) => a + c.value, 0)).toBe(x.value);
    const f = await forecastReport(db, exec);
    expect(f.rows.find((r) => r.sku === "SES-SRV1U-STD")!.weekly.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);
    const p = await pipelineReport(db, exec, parseRange({ range: "12m" }));
    expect(p.totals.leads).toBeGreaterThanOrEqual(0);
  });

  it("send the weekly summary to report readers only, and stop when switched off", async () => {
    const sent = await sendWeeklyDigest(db);
    expect(sent).toBeGreaterThanOrEqual(1);
    const mails = (await db.select().from(mailOutbox)).filter((m) => m.subject.startsWith("Weekly summary"));
    expect(mails.find((m) => m.to === "sales@ses.demo")).toBeUndefined();
    await updateSettings(db, await as("admin@ses.demo"), { weeklyReport: false });
    expect(await sendWeeklyDigest(db)).toBe(0);
  });
});
