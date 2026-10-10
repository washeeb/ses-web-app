import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { assets, invoices, notifications, productVariants, subscriptions, tickets, users } from "@/server/db/schema";
import { acceptQuote, confirmOrder, createQuote, fulfilOrder, sendQuote, submitQuote } from "@/server/modules/sales";
import { addPeriod, addServiceMinutes, serviceMinutesBetween } from "@/server/modules/service-time";
import { cancelSubscription, createContract, createSubscription, getSubscription, listSubscriptions, runRenewals, setAutoRenew } from "@/server/modules/subscriptions";
import { recordManualPayment } from "@/server/modules/invoices";
import { assignTicket, autoCloseTickets, checkSla, createTicket, escalateTicket, getTicket, listTickets, replyToTicket, setTicketPriority, setTicketStatus } from "@/server/modules/tickets";
import { createAsset, getAsset, listAssets, updateAsset } from "@/server/modules/assets";
import { addMilestone, addTask, createProject, decideSignoff, getProject, listProjects, requestSignoff, setProjectStatus, setTaskStatus } from "@/server/modules/projects";

let db: DB;
let close: () => Promise<void>;
let orgs: Awaited<ReturnType<typeof setupDb>>["organizations"];
beforeAll(async () => ({ db, close, organizations: orgs } = await setupDb()));
afterAll(async () => close());

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);
const variant = async (sku: string) => (await db.select().from(productVariants).where(eq(productVariants.sku, sku)))[0]!;
const as = (email: string, mfa = true) => actorFor(db, email, mfa);
const userId = async (email: string) => (await db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]!.id;
const noticesFor = async (email: string, title: string) =>
  (await db.select().from(notifications).where(and(eq(notifications.userId, await userId(email)), eq(notifications.title, title)))).length;

describe("service clock", () => {
  it("counts business hours Monday–Friday 08:00–17:00 Accra", () => {
    // Friday 16:00 + 2 business hours → Monday 09:00
    expect(addServiceMinutes(at("2026-10-09T16:00:00Z"), 120, "business_hours").toISOString()).toBe("2026-10-12T09:00:00.000Z");
    // Before opening: starts at 08:00
    expect(addServiceMinutes(at("2026-10-12T06:30:00Z"), 60, "business_hours").toISOString()).toBe("2026-10-12T09:00:00.000Z");
    // Saturday counts nothing
    expect(addServiceMinutes(at("2026-10-10T10:00:00Z"), 30, "business_hours").toISOString()).toBe("2026-10-12T08:30:00.000Z");
    expect(addServiceMinutes(at("2026-10-10T10:00:00Z"), 30, "24x7").toISOString()).toBe("2026-10-10T10:30:00.000Z");
    expect(serviceMinutesBetween(at("2026-10-09T16:00:00Z"), at("2026-10-12T09:00:00Z"), "business_hours")).toBe(120);
  });

  it("adds billing periods safely at month ends", () => {
    expect(addPeriod(at("2026-01-31T10:00:00Z"), "month").toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addPeriod(at("2028-02-29T00:00:00Z"), "year").toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });
});

async function fulfilledOrder(lines: [string, number][]) {
  const sales = await as("sales@ses.demo");
  const q = await createQuote(db, sales, { customerOrgId: orgs.custA.id, discountBp: 0, lines: await Promise.all(lines.map(async ([sku, quantity]) => ({ variantId: (await variant(sku)).id, quantity }))) });
  await submitQuote(db, sales, q.id);
  await sendQuote(db, sales, q.id);
  const o = await acceptQuote(db, await as("buyer.admin@customer-a.demo"), q.id);
  await confirmOrder(db, sales, o.id);
  await fulfilOrder(db, await as("warehouse@ses.demo"), o.id);
  return o;
}

describe("subscriptions", () => {
  it("start when an order with recurring items is delivered; hardware becomes registered assets", async () => {
    const o = await fulfilledOrder([["SES-BKP-1TB-M", 1], ["SES-LAP14-I5-16", 2]]);
    const subs = await db.select().from(subscriptions).where(eq(subscriptions.sourceOrderId, o.id));
    expect(subs).toHaveLength(1);
    expect(subs[0]!.billingPeriod).toBe("month");
    expect(Math.round((subs[0]!.currentPeriodEnd.getTime() - subs[0]!.currentPeriodStart.getTime()) / DAY)).toBeGreaterThanOrEqual(28);
    expect(await db.select().from(assets).where(eq(assets.orderId, o.id))).toHaveLength(2);
  });

  it("renew on payment of the renewal invoice, issued once at the notice date", async () => {
    const sales = await as("sales@ses.demo");
    const sub = await createSubscription(db, sales, { customerOrgId: orgs.custA.id, variantId: (await variant("SES-OFFICE-USR-Y")).id, quantity: 10, startsOn: "2026-01-01" });
    const end = sub.currentPeriodEnd; // 2027-01-01
    await runRenewals(db, new Date(end.getTime() - 40 * DAY));
    expect((await getSubscription(db, sales, sub.id)).renewalInvoiceId).toBeNull(); // not yet within 30 days
    await runRenewals(db, new Date(end.getTime() - 29 * DAY));
    await runRenewals(db, new Date(end.getTime() - 28 * DAY)); // idempotent
    const s1 = await getSubscription(db, sales, sub.id);
    expect(s1.renewals).toHaveLength(1);
    const inv = s1.renewals[0]!;
    expect(inv.subtotalMinor).toBe(10 * 165_000);
    expect(inv.dueAt.getTime()).toBe(end.getTime());
    await recordManualPayment(db, await as("finance@ses.demo"), inv.id, { amountMinor: inv.totalMinor, method: "bank_transfer", externalReference: "REN-1", paidOn: "2026-10-09" });
    const s2 = await getSubscription(db, sales, sub.id);
    expect(s2.renewalInvoiceId).toBeNull();
    expect(s2.currentPeriodStart.toISOString()).toBe(end.toISOString());
    expect(s2.currentPeriodEnd.toISOString()).toBe("2028-01-01T00:00:00.000Z");
  });

  it("lapse when the renewal is unpaid after the grace period, voiding the invoice", async () => {
    const sub = await createSubscription(db, await as("sales@ses.demo"), { customerOrgId: orgs.custA.id, variantId: (await variant("SES-NMON-SITE-M")).id, quantity: 3, startsOn: "2026-03-01" });
    await runRenewals(db, new Date(sub.currentPeriodEnd.getTime() - 5 * DAY));
    const [s] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
    await runRenewals(db, new Date(sub.currentPeriodEnd.getTime() + 15 * DAY));
    const [after] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
    expect(after!.status).toBe("lapsed");
    expect((await db.select().from(invoices).where(eq(invoices.id, s!.renewalInvoiceId!)))[0]!.status).toBe("void");
  });

  it("customer administrators (not users) can stop renewal; the subscription then ends at period end", async () => {
    const sub = await createSubscription(db, await as("sales@ses.demo"), { customerOrgId: orgs.custA.id, variantId: (await variant("SES-BKP-5TB-M")).id, quantity: 1, startsOn: "2026-05-01" });
    await runRenewals(db, new Date(sub.currentPeriodEnd.getTime() - 3 * DAY));
    const [withInvoice] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
    await expect(setAutoRenew(db, await as("buyer@customer-a.demo"), sub.id, false)).rejects.toMatchObject({ code: "forbidden" });
    await expect(setAutoRenew(db, await as("admin@customer-b.demo"), sub.id, false)).rejects.toMatchObject({ code: "not_found" });
    await setAutoRenew(db, await as("buyer.admin@customer-a.demo"), sub.id, false);
    expect((await db.select().from(invoices).where(eq(invoices.id, withInvoice!.renewalInvoiceId!)))[0]!.status).toBe("void");
    await runRenewals(db, new Date(sub.currentPeriodEnd.getTime() + DAY));
    expect((await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id)))[0]!.status).toBe("ended");
  });

  it("are visible only to the owning customer; staff can cancel", async () => {
    expect((await listSubscriptions(db, await as("buyer@customer-a.demo"))).every((r) => r.s.customerOrgId === orgs.custA.id)).toBe(true);
    expect(await listSubscriptions(db, await as("admin@customer-b.demo"))).toHaveLength(0);
    const sub = await createSubscription(db, await as("sales@ses.demo"), { customerOrgId: orgs.custB.id, variantId: (await variant("SES-BKP-1TB-M")).id, quantity: 1, startsOn: "2026-06-01" });
    await expect(cancelSubscription(db, await as("buyer.admin@customer-a.demo"), sub.id, "no")).rejects.toThrow();
    await cancelSubscription(db, await as("sales@ses.demo"), sub.id, "Customer moved provider");
    expect((await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id)))[0]!.status).toBe("cancelled");
  });
});

describe("support tickets and SLAs", () => {
  const targets = {
    urgent: { responseHours: 1, resolutionHours: 4 },
    high: { responseHours: 2, resolutionHours: 8 },
    normal: { responseHours: 4, resolutionHours: 24 },
    low: { responseHours: 8, resolutionHours: 72 },
  };

  it("use the customer's contract targets, or the default business-hours SLA", async () => {
    await createContract(db, await as("sales@ses.demo"), { customerOrgId: orgs.custA.id, name: "Premium 24x7", coverage: "24x7", startsOn: "2026-01-01", endsOn: "2027-12-31", targets });
    const now = at("2026-10-10T22:00:00Z"); // Saturday night
    const t = await createTicket(db, await as("buyer@customer-a.demo"), { subject: "Core switch down", description: "All floors offline since 21:50.", priority: "urgent" }, now);
    expect(t.coverage).toBe("24x7");
    expect(t.responseDueAt.toISOString()).toBe("2026-10-10T23:00:00.000Z");
    const b = await createTicket(db, await as("admin@customer-b.demo"), { subject: "Printer offline", description: "Reception printer will not print.", priority: "normal" }, now);
    expect(b.coverage).toBe("business_hours");
    expect(b.responseDueAt.toISOString()).toBe("2026-10-12T16:00:00.000Z"); // 8 business hours from Monday 08:00
  });

  it("keep customers apart and hide internal notes from them", async () => {
    const t = await createTicket(db, await as("buyer@customer-a.demo"), { subject: "VPN fails for two users", description: "Error 809 when connecting from home." });
    await expect(getTicket(db, await as("admin@customer-b.demo"), t.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await listTickets(db, await as("admin@customer-b.demo"), { filter: "all" })).some((r) => r.t.id === t.id)).toBe(false);
    const support = await as("support@ses.demo");
    await replyToTicket(db, support, t.id, "Suspect expired certificate on the gateway.", { internal: true });
    await replyToTicket(db, support, t.id, "We are checking the VPN gateway now.");
    const seenByCustomer = await getTicket(db, await as("buyer@customer-a.demo"), t.id);
    expect(seenByCustomer.messages.map((m) => m.m.body)).toEqual(["Error 809 when connecting from home.", "We are checking the VPN gateway now."]);
    expect(seenByCustomer.firstRespondedAt).not.toBeNull();
    expect(seenByCustomer.status).toBe("open");
    await expect(replyToTicket(db, await as("buyer@customer-a.demo"), t.id, "sneaky", { internal: true })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("pause the resolution clock while waiting on the customer", async () => {
    const t0 = at("2026-10-12T09:00:00Z"); // Monday
    const t = await createTicket(db, await as("admin@customer-b.demo"), { subject: "Need new user mailbox", description: "Please create a mailbox for our new accountant." }, t0);
    const support = await as("support@ses.demo");
    await setTicketStatus(db, support, t.id, "pending_customer", at("2026-10-12T10:00:00Z"));
    await replyToTicket(db, await as("admin@customer-b.demo"), t.id, "Name is Ama Owusu, ama@customer-b.demo", {}, at("2026-10-12T13:00:00Z"));
    const after = (await db.select().from(tickets).where(eq(tickets.id, t.id)))[0]!;
    expect(after.status).toBe("open");
    expect(after.resolutionDueAt.getTime() - t.resolutionDueAt.getTime()).toBe(3 * 3_600_000); // 3 business hours waited
  });

  it("escalate L1 → L2 → engineering, alerting engineers at L3", async () => {
    const t = await createTicket(db, await as("buyer@customer-a.demo"), { subject: "ERP posting error", description: "Invoices fail to post with error 500." });
    const support = await as("support@ses.demo");
    await escalateTicket(db, support, t.id, "Needs database access");
    await escalateTicket(db, support, t.id, "Looks like a code defect");
    expect((await db.select().from(tickets).where(eq(tickets.id, t.id)))[0]!.level).toBe(3);
    expect(await noticesFor("engineer@ses.demo", `Ticket ${t.number} escalated to Engineering (L3)`)).toBe(1);
    await expect(escalateTicket(db, support, t.id, "again please")).rejects.toMatchObject({ code: "conflict" });
    await expect(escalateTicket(db, await as("sales@ses.demo"), t.id, "not mine")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("flag SLA breaches once and alert the assignee", async () => {
    const t0 = at("2026-10-13T09:00:00Z");
    const t = await createTicket(db, await as("admin@customer-b.demo"), { subject: "Website down", description: "Our site returns 503.", priority: "high" }, t0);
    await assignTicket(db, await as("support@ses.demo"), t.id, await userId("support@ses.demo"));
    const later = new Date(t.resolutionDueAt.getTime() + 60_000);
    expect(await checkSla(db, later)).toBeGreaterThanOrEqual(2); // response and resolution
    expect(await checkSla(db, later)).toBe(0);
    const row = (await db.select().from(tickets).where(eq(tickets.id, t.id)))[0]!;
    expect(row.responseBreached && row.resolutionBreached).toBe(true);
    expect(await noticesFor("support@ses.demo", `SLA breached: resolution on ${t.number}`)).toBe(1);
    await setTicketPriority(db, await as("support@ses.demo"), t.id, "low");
    expect((await db.select().from(tickets).where(eq(tickets.id, t.id)))[0]!.resolutionBreached).toBe(false);
  });

  it("reopen when the customer replies to a resolved ticket, and close automatically later", async () => {
    const support = await as("support@ses.demo");
    const t = await createTicket(db, await as("buyer@customer-a.demo"), { subject: "Laptop battery", description: "Battery drains in one hour." });
    await setTicketStatus(db, support, t.id, "resolved");
    await replyToTicket(db, await as("buyer@customer-a.demo"), t.id, "Still happening.");
    expect((await db.select().from(tickets).where(eq(tickets.id, t.id)))[0]!.status).toBe("open");
    await expect(setTicketStatus(db, support, t.id, "closed")).rejects.toMatchObject({ code: "conflict" });
    await setTicketStatus(db, support, t.id, "resolved");
    await autoCloseTickets(db, new Date(Date.now() + 8 * DAY));
    expect((await db.select().from(tickets).where(eq(tickets.id, t.id)))[0]!.status).toBe("closed");
    await expect(replyToTicket(db, await as("buyer@customer-a.demo"), t.id, "hello?")).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("assets", () => {
  it("are visible to their customer only; staff keep serials and link contracts of the same customer", async () => {
    const staff = await as("support@ses.demo");
    const a = await createAsset(db, staff, orgs.custB.id, { name: "Firewall", serialNumber: "FW-001", location: "Server room" });
    expect((await listAssets(db, await as("buyer@customer-a.demo"))).some((r) => r.a.id === a.id)).toBe(false);
    await expect(getAsset(db, await as("buyer@customer-a.demo"), a.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await getAsset(db, await as("admin@customer-b.demo"), a.id)).serialNumber).toBe("FW-001");
    const contractA = await createContract(db, await as("sales@ses.demo"), { customerOrgId: orgs.custA.id, name: "A support", coverage: "business_hours", startsOn: "2026-01-01", endsOn: "2026-12-31", targets: { urgent: { responseHours: 1, resolutionHours: 8 }, high: { responseHours: 2, resolutionHours: 16 }, normal: { responseHours: 4, resolutionHours: 40 }, low: { responseHours: 8, resolutionHours: 80 } } });
    await expect(updateAsset(db, staff, a.id, { name: "Firewall", contractId: contractA.id })).rejects.toThrow(/different customer/);
    await expect(createTicket(db, await as("buyer@customer-a.demo"), { subject: "Firewall alarm", description: "Red light flashing on it.", assetId: a.id })).rejects.toThrow(/not registered/);
    await expect(createAsset(db, await as("sales@ses.demo"), orgs.custB.id, { name: "x" })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("projects", () => {
  it("move milestones through sign-off by the customer's administrator", async () => {
    const pm = await as("engineer@ses.demo");
    const p = await createProject(db, pm, { name: "Head office Wi-Fi upgrade", customerOrgId: orgs.custA.id });
    const m = await addMilestone(db, pm, p.id, { name: "Site survey" });
    const task = await addTask(db, pm, p.id, { title: "Survey floors 1–3", milestoneId: m.id });
    await expect(requestSignoff(db, pm, m.id)).rejects.toThrow(/not done/);
    await setTaskStatus(db, pm, task.id, "done");
    await requestSignoff(db, pm, m.id);
    await expect(setTaskStatus(db, pm, task.id, "todo")).rejects.toMatchObject({ code: "conflict" });
    await expect(decideSignoff(db, await as("buyer@customer-a.demo"), m.id, true, "")).rejects.toMatchObject({ code: "forbidden" });
    await expect(decideSignoff(db, await as("admin@customer-b.demo"), m.id, true, "")).rejects.toMatchObject({ code: "not_found" });
    await expect(decideSignoff(db, await as("buyer.admin@customer-a.demo"), m.id, false, "")).rejects.toThrow(/what still needs/);
    await decideSignoff(db, await as("buyer.admin@customer-a.demo"), m.id, false, "Survey misses the warehouse.");
    expect((await getProject(db, pm, p.id)).milestones[0]!.status).toBe("open");
    await requestSignoff(db, pm, m.id);
    await decideSignoff(db, await as("buyer.admin@customer-a.demo"), m.id, true, "Looks good");
    await setProjectStatus(db, pm, p.id, "completed");
    expect((await getProject(db, await as("buyer@customer-a.demo"), p.id)).status).toBe("completed");
    expect(await listProjects(db, await as("admin@customer-b.demo"))).toHaveLength(0);
  });

  it("cannot be completed with open milestones; internal sign-off needs a second person", async () => {
    const pm = await as("engineer@ses.demo");
    const p = await createProject(db, pm, { name: "Internal monitoring rebuild" });
    const m = await addMilestone(db, pm, p.id, { name: "Design" });
    await expect(setProjectStatus(db, pm, p.id, "completed")).rejects.toThrow(/signed off/);
    await requestSignoff(db, pm, m.id);
    await expect(decideSignoff(db, pm, m.id, true, "")).rejects.toMatchObject({ code: "forbidden" });
    await decideSignoff(db, await as("admin@ses.demo"), m.id, true, "Approved");
    await expect(createProject(db, await as("sales@ses.demo"), { name: "Not allowed" })).rejects.toMatchObject({ code: "forbidden" });
  });
});
