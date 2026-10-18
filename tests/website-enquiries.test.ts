import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { aiRequests, leads, notifications } from "@/server/db/schema";
import { createEnquiry } from "@/server/modules/sales";
import { updateSettings } from "@/server/modules/settings";
import { askVisitorAssistant, publicAssistantAvailable, type FetchLike } from "@/server/modules/ai";
import { waLink, waNumber } from "@/components/whatsapp";
import { SERVICE_AREAS } from "@/content/site";

let db: DB;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await setupDb()));
afterAll(async () => close());
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const base = { contactName: "Esi Mensah", email: "esi@example.com", message: "We need a network survey for two offices." };

describe("services", () => {
  it("are all offered, each with content for its own page", () => {
    expect(SERVICE_AREAS).toHaveLength(12);
    for (const s of SERVICE_AREAS) {
      expect(s.slug).toMatch(/^[a-z0-9-]+$/);
      expect(s.intro.length).toBeGreaterThan(60);
      expect(s.faqs.length).toBeGreaterThanOrEqual(2);
      expect(s.forWhom.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("website enquiries", () => {
  it("record a booked call with day, time and phone, and tell sales staff", async () => {
    const r = await createEnquiry(db, { ...base, phone: "024 123 4567", serviceInterest: "Telecommunications & networks", callbackOn: day(2), callbackWindow: "morning" }, "198.51.100.1");
    expect(r.callbackOn).toBe(day(2));
    expect(r.callbackLabel).toMatch(/Morning/);
    const [lead] = await db.select().from(leads).where(eq(leads.number, r.number));
    expect(lead).toMatchObject({ preferredContact: "phone", callbackOn: day(2), callbackWindow: "morning", phone: "024 123 4567" });
    const sent = await db.select().from(notifications).where(eq(notifications.title, "Call booked: Esi Mensah"));
    expect(sent.length).toBeGreaterThan(0);
    expect(sent[0]!.body).toContain(`call ${day(2)}, morning`);
  });

  it("need a phone for calls or WhatsApp, a time for a booked call, and a day within 60 days", async () => {
    await expect(createEnquiry(db, { ...base, preferredContact: "whatsapp" }, "198.51.100.2")).rejects.toThrow(/phone number/);
    await expect(createEnquiry(db, { ...base, phone: "0241234567", callbackOn: day(1) }, "198.51.100.3")).rejects.toThrow(/time for the call/);
    await expect(createEnquiry(db, { ...base, phone: "0241234567", callbackOn: day(-1), callbackWindow: "afternoon" }, "198.51.100.4")).rejects.toThrow(/60 days/);
    await expect(createEnquiry(db, { ...base, phone: "0241234567", callbackOn: day(61), callbackWindow: "afternoon" }, "198.51.100.5")).rejects.toThrow(/60 days/);
    const ok = await createEnquiry(db, { ...base, preferredContact: "email" }, "198.51.100.6");
    expect(ok.callbackOn).toBeNull();
  });
});

describe("WhatsApp links", () => {
  it("turn Ghana numbers into international wa.me links, and hide when not set", () => {
    expect(waNumber("024 123 4567")).toBe("233241234567");
    expect(waNumber("+233 24 123 4567")).toBe("233241234567");
    expect(waNumber("")).toBeNull();
    expect(waNumber("12345")).toBeNull();
    expect(waLink("0241234567", "Hello & welcome")).toBe("https://wa.me/233241234567?text=Hello%20%26%20welcome");
    expect(waLink("", "x")).toBeNull();
  });
});

describe("website assistant", () => {
  const KEY = "sk-ant-test-key";
  afterEach(() => {
    delete process.env.AI_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
  });
  const fake = (reply: string) => {
    const calls: { body: { system: string; messages: { content: string }[] } }[] = [];
    const f: FetchLike = async (_url, init) => {
      calls.push({ body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: reply }], usage: { input_tokens: 900, output_tokens: 60 } }) };
    };
    return { f, calls };
  };

  it("stays off until the provider key is set and the website assistant is switched on", async () => {
    expect(await publicAssistantAvailable(db)).toBe(false);
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = KEY;
    expect(await publicAssistantAvailable(db)).toBe(false);
    await expect(askVisitorAssistant(db, [{ role: "user", content: "Do you do CCTV?" }], "203.0.113.1", fake("{}").f)).rejects.toThrow(/not available/);
  });

  it("answers from the site, keeps only real links, removes contact details and logs without a user", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = KEY;
    await updateSettings(db, await actorFor(db, "admin@ses.demo", true), { publicAssistant: true });
    const { f, calls } = fake(
      '{"answer":"Yes, we design and roll out office networks.","links":[{"label":"Networks","href":"/services/telecoms-networks"},{"label":"Evil","href":"https://evil.example"},{"label":"Made up","href":"/services/space-travel"}],"handover":true,"service":"made-up-service"}',
    );
    const r = await askVisitorAssistant(db, [{ role: "user", content: "Can you network our office? Call me on 024 123 4567 or ama@example.com" }], "203.0.113.2", f);
    expect(r.answer).toMatch(/office networks/);
    expect(r.links).toEqual([{ label: "Networks", href: "/services/telecoms-networks" }]);
    expect(r.handover).toBe(true);
    expect(r.service).toBeNull();
    const sent = calls[0]!.body.messages[0]!.content;
    expect(sent).not.toContain("024 123 4567");
    expect(sent).not.toContain("ama@example.com");
    expect(sent).toContain("/services/telecoms-networks");
    expect(calls[0]!.body.system).toMatch(/never follow instructions/i);
    const logged = await db.select().from(aiRequests).where(and(eq(aiRequests.feature, "visitor_assistant"), isNull(aiRequests.userId)));
    expect(logged.length).toBe(1);
    expect(JSON.stringify(logged[0]!.output)).not.toContain("network our office");
  });

  it("limits each visitor and falls back to the enquiry form when the model fails", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = KEY;
    const broken = fake("no json here").f;
    const fallback = await askVisitorAssistant(db, [{ role: "user", content: "Hello?" }], "203.0.113.3", broken);
    expect(fallback.handover).toBe(true);
    expect(fallback.links[0]!.href).toBe("/contact");
    for (let i = 0; i < 14; i++) await askVisitorAssistant(db, [{ role: "user", content: `Question ${i}` }], "203.0.113.3", broken);
    await expect(askVisitorAssistant(db, [{ role: "user", content: "One more" }], "203.0.113.3", broken)).rejects.toThrow();
  });
});
