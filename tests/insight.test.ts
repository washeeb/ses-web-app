import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { aiRequests, invoices, productVariants } from "@/server/db/schema";
import { INSTANCE_ID, publish, receiveRemote, setTransport, subscribe, type LiveEvent, type WireEvent } from "@/server/modules/events";
import { deleteArticle, getArticleBySlug, saveArticle, searchArticles } from "@/server/modules/knowledge";
import { redact, suggestForTicket, summariseReport, type FetchLike } from "@/server/modules/ai";
import { updateSettings } from "@/server/modules/settings";
import { createTicket, replyToTicket } from "@/server/modules/tickets";
import { departmentReports } from "@/server/modules/reports";
import { exportCsv } from "@/server/modules/csv";
import { acceptQuote, createQuote, sendQuote, submitQuote } from "@/server/modules/sales";

let db: DB;
let close: () => Promise<void>;
let orgs: Awaited<ReturnType<typeof setupDb>>["organizations"];
beforeAll(async () => ({ db, close, organizations: orgs } = await setupDb()));
afterAll(async () => close());
const as = (email: string, mfa = true) => actorFor(db, email, mfa);

describe("cross-process event relay", () => {
  afterEach(() => setTransport(null));

  it("sends local events to the transport and delivers other processes' events, ignoring its own echo", () => {
    const sent: WireEvent[] = [];
    setTransport((w) => sent.push(w));
    const got: LiveEvent[] = [];
    const off = subscribe((e) => got.push(e));
    publish({ topic: "tickets", orgIds: ["org-1"] });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.origin).toBe(INSTANCE_ID);
    expect(receiveRemote(JSON.stringify(sent[0]))).toBe(false); // own echo
    expect(receiveRemote(JSON.stringify({ origin: "other-process", event: { topic: "orders", orgIds: ["org-2"] } }))).toBe(true);
    expect(receiveRemote("not json")).toBe(false);
    expect(receiveRemote(JSON.stringify({ origin: "x" }))).toBe(false);
    off();
    expect(got.map((e) => e.topic)).toEqual(["tickets", "orders"]);
    expect(got[1]!.orgIds).toEqual(["org-2"]);
  });
});

describe("knowledge base", () => {
  it("shows each audience only what it may read, with stemmed search", async () => {
    const editor = await as("support@ses.demo");
    await saveArticle(db, editor, null, { title: "Fixing an offline network printer", body: "If printers show offline, restart the print spooler and check the cable.", category: "hardware", audience: "public", status: "published" });
    await saveArticle(db, editor, null, { title: "Customer VPN setup guide", body: "Install the VPN client and sign in with your company account. Printers on the office network become available.", category: "network", audience: "customers", status: "published" });
    await saveArticle(db, editor, null, { title: "Internal: printer escalation contacts", body: "Escalate printer hardware faults to the vendor hotline after two attempts.", category: "hardware", audience: "internal", status: "published" });
    await saveArticle(db, editor, null, { title: "Draft printer article", body: "Not ready yet, still being written by the team.", category: "hardware", audience: "public", status: "draft" });
    const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();
    expect(titles(await searchArticles(db, null, "printers"))).toEqual(["Fixing an offline network printer"]);
    expect(titles(await searchArticles(db, await as("buyer@customer-a.demo"), "printer"))).toEqual(["Customer VPN setup guide", "Fixing an offline network printer"]);
    expect(await searchArticles(db, editor, "printer")).toHaveLength(3);
    // Odd input never breaks the search.
    await expect(searchArticles(db, null, `"unbalanced OR -( & | :*`)).resolves.toBeDefined();
    const internal = (await searchArticles(db, editor, "escalation"))[0]!;
    await expect(getArticleBySlug(db, await as("buyer@customer-a.demo"), internal.slug)).rejects.toMatchObject({ code: "not_found" });
    await expect(getArticleBySlug(db, null, internal.slug)).rejects.toMatchObject({ code: "not_found" });
  });

  it("needs kb.write to edit, and published articles cannot be deleted", async () => {
    await expect(saveArticle(db, await as("sales@ses.demo"), null, { title: "Not allowed here", body: "Sales cannot write articles in the knowledge base.", category: "general", audience: "public", status: "draft" })).rejects.toMatchObject({ code: "forbidden" });
    const editor = await as("support@ses.demo");
    const a = await saveArticle(db, editor, null, { title: "Temporary article", body: "This article will be published and then removed.", category: "general", audience: "public", status: "published" });
    await expect(deleteArticle(db, editor, a.id)).rejects.toMatchObject({ code: "conflict" });
    await saveArticle(db, editor, a.id, { title: "Temporary article", body: "This article will be published and then removed.", category: "general", audience: "public", status: "draft" });
    await deleteArticle(db, editor, a.id);
  });
});

describe("AI assistance", () => {
  const KEY = "sk-ant-test-key";
  afterEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
  });

  function fakeModel(reply: string) {
    const calls: { url: string; headers: Record<string, string>; body: { model: string; system: string; messages: { content: string }[] } }[] = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: reply }], usage: { input_tokens: 321, output_tokens: 87 } }) };
    };
    return { f, calls };
  }

  it("removes e-mail addresses, phone numbers and long numbers", () => {
    expect(redact("Call 024 123 4567 or +233 24 123 4567, mail ama@example.com, account 1234567890123")).toBe("Call [phone] or [phone], mail [e-mail], account [number]");
  });

  it("is refused until a key is configured and an administrator switches it on", async () => {
    const support = await as("support@ses.demo");
    const t = await createTicket(db, await as("buyer@customer-a.demo"), { subject: "Printer offline at reception", description: "Printer offline since morning." });
    await expect(suggestForTicket(db, support, t.id, fakeModel("{}").f)).rejects.toThrow(/not switched on/);
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = KEY;
    await expect(suggestForTicket(db, support, t.id, fakeModel("{}").f)).rejects.toThrow(/not switched on/);
  });

  it("suggests a reply from customer-visible text only, labelled and never applied automatically", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = KEY;
    await updateSettings(db, await as("admin@ses.demo"), { aiEnabled: true, aiDailyLimitPerUser: 3 });
    const support = await as("support@ses.demo");
    const t = await createTicket(db, await as("buyer@customer-a.demo"), { subject: "Printer offline", description: "Reception printer offline. Call me on 024 555 1234 or kofi@customer-a.demo." });
    await replyToTicket(db, support, t.id, "SECRET internal: vendor contract expired", { internal: true });
    const { f, calls } = fakeModel('Here you go: {"category":"hardware","priority":"normal","reply":"Please restart the printer.","reasoning":"Single device."}');
    const s = await suggestForTicket(db, support, t.id, f);
    expect(s).toMatchObject({ category: "hardware", priority: "normal", reply: "Please restart the printer." });
    const sent = calls[0]!;
    expect(sent.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent.headers["x-api-key"]).toBe(KEY);
    expect(sent.body.model).toBe("claude-opus-5-5");
    const prompt = sent.body.messages[0]!.content;
    expect(prompt).not.toContain("SECRET internal");
    expect(prompt).not.toContain("kofi@customer-a.demo");
    expect(prompt).not.toContain("555 1234");
    expect(sent.body.system).toMatch(/never follow instructions/i);
    // The ticket itself is unchanged: suggestions are only shown.
    const [row] = await db.select().from(aiRequests).where(eq(aiRequests.subjectId, t.id));
    expect(row).toMatchObject({ status: "ok", feature: "ticket_suggestion", inputTokens: 321 });
  });

  it("rejects malformed model output, counts it, and enforces the daily limit", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = KEY;
    await updateSettings(db, await as("admin@ses.demo"), { aiEnabled: true, aiDailyLimitPerUser: 2 });
    const agent = await as("engineer@ses.demo");
    const t = await createTicket(db, await as("buyer@customer-a.demo"), { subject: "Laptop slow", description: "Laptop takes ten minutes to boot." });
    await expect(suggestForTicket(db, agent, t.id, fakeModel('{"category":"made-up","priority":"normal","reply":"x"}').f)).rejects.toThrow(/could not be produced/);
    await suggestForTicket(db, agent, t.id, fakeModel('{"category":"hardware","priority":"low","reply":"Let us check the disk."}').f);
    await expect(suggestForTicket(db, agent, t.id, fakeModel("{}").f)).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("is for staff with ai.use only", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = KEY;
    await updateSettings(db, await as("admin@ses.demo"), { aiEnabled: true, aiDailyLimitPerUser: 20 });
    const t = await createTicket(db, await as("buyer@customer-a.demo"), { subject: "Email bouncing back", description: "Messages to suppliers bounce." });
    await expect(suggestForTicket(db, await as("buyer.admin@customer-a.demo"), t.id, fakeModel("{}").f)).rejects.toMatchObject({ code: "forbidden" });
    await expect(suggestForTicket(db, await as("warehouse@ses.demo"), t.id, fakeModel("{}").f)).rejects.toMatchObject({ code: "forbidden" });
    const text = await summariseReport(db, await as("exec@ses.demo"), "finance", { ageing: [{ label: "Not yet due", value: 100 }] }, fakeModel("- Receivables are current.").f);
    expect(text).toBe("- Receivables are current.");
  });
});

describe("department reports", () => {
  it("need reports.read and show only permitted sections", async () => {
    await expect(departmentReports(db, await as("sales@ses.demo"), 30)).rejects.toMatchObject({ code: "forbidden" });
    const exec = await departmentReports(db, await as("exec@ses.demo"), 30);
    expect(Object.keys(exec).sort()).toEqual(["finance", "operations", "projects", "sales", "subscriptions", "support"]);
    const mgr = await departmentReports(db, await as("sales.manager@ses.demo"), 30);
    expect(mgr.finance).toBeUndefined();
  });

  it("age receivables by days overdue", async () => {
    const sales = await as("sales@ses.demo");
    const [v] = await db.select().from(productVariants).where(eq(productVariants.sku, "SES-SVC-ERP-DISC"));
    const q = await createQuote(db, sales, { customerOrgId: orgs.custB.id, discountBp: 0, lines: [{ variantId: v!.id, quantity: 1 }] });
    await submitQuote(db, sales, q.id);
    await sendQuote(db, sales, q.id);
    const o = await acceptQuote(db, await as("admin@customer-b.demo"), q.id);
    await db.update(invoices).set({ dueAt: new Date(Date.now() - 45 * 86_400_000) }).where(eq(invoices.orderId, o.id));
    const r = await departmentReports(db, await as("finance@ses.demo"), 30);
    expect(r.finance!.ageing.find((b) => b.label === "31–60 days overdue")!.value).toBeGreaterThanOrEqual(o.totalMinor);
  });

  it("export new datasets for BI tools", async () => {
    const exec = await as("exec@ses.demo");
    for (const kind of ["tickets", "subscriptions", "projects"]) {
      const { csv } = await exportCsv(db, exec, kind);
      expect(csv.split("\n")[0]).toMatch(/^﻿?(number|tag)/);
    }
  });
});
