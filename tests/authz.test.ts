import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { actorFor, setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { approvalRequests, leads, permissionSets, roleAssignments, users } from "@/server/db/schema";
import { can } from "@/server/authz/policy";
import { listLeads, updateLeadStatus } from "@/server/modules/sales";
import { listAudit } from "@/server/modules/audit";
import { updateSettings } from "@/server/modules/settings";
import { assignRole } from "@/server/modules/admin";
import { decideApproval } from "@/server/modules/approvals";
import { listConnections } from "@/server/modules/integrations/manage";
import { ROLE_TEMPLATES } from "@/server/authz/roles";
import { PERMISSIONS } from "@/server/authz/permissions";

let db: DB;
let close: () => Promise<void>;
let orgs: Awaited<ReturnType<typeof setupDb>>["organizations"];
beforeAll(async () => ({ db, close, organizations: orgs } = await setupDb()));
afterAll(() => close());

describe("role templates", () => {
  it("only contain permissions of their own domain", () => {
    for (const r of ROLE_TEMPLATES) for (const p of r.permissions) expect(PERMISSIONS[p].domain, `${r.key}:${p}`).toBe(r.domain);
  });
  it("the auditor cannot change anything", () => {
    const auditor = ROLE_TEMPLATES.find((r) => r.key === "auditor")!;
    expect(auditor.permissions.filter((p) => /\.(write|manage|approve|adjust|accept)$/.test(p))).toEqual([]);
  });
});

describe("policy", () => {
  it("privileged permissions require an MFA-verified session", async () => {
    expect(can(await actorFor(db, "admin@ses.demo", false), "settings.manage")).toBe(false);
    expect(can(await actorFor(db, "admin@ses.demo", true), "settings.manage")).toBe(true);
    await expect(updateSettings(db, await actorFor(db, "admin@ses.demo", false), { quoteValidityDays: 10 })).rejects.toMatchObject({ code: "mfa_required" });
  });

  it("customers and partners cannot use operator permissions, even if assigned", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "buyer@customer-a.demo"));
    const [admin] = await db.select().from(permissionSets).where(eq(permissionSets.key, "platform_admin"));
    // Force a mis-assignment directly in the DB: the policy must still refuse it.
    await db.insert(roleAssignments).values({ userId: u!.id, permissionSetId: admin!.id, organizationId: u!.organizationId });
    const actor = await actorFor(db, "buyer@customer-a.demo", true);
    expect(can(actor, "audit.read")).toBe(false);
    await expect(listAudit(db, actor)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("customer permissions never reach another customer's records", async () => {
    const a = await actorFor(db, "buyer.admin@customer-a.demo");
    expect(can(a, "customer.quotes.read", { organizationId: orgs.custA.id })).toBe(true);
    expect(can(a, "customer.quotes.read", { organizationId: orgs.custB.id })).toBe(false);
  });

  it("partner users cannot read integration management", async () => {
    await expect(listConnections(db, await actorFor(db, "partner.admin@kingsview.demo"))).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("department scoping", () => {
  it("a department-scoped sales officer sees and edits only sales or shared leads", async () => {
    const ses = orgs.ses.id;
    const [salesDept, hrDept] = await Promise.all(
      ["sales", "hr"].map(async (k) => (await db.query.departments.findFirst({ where: (d, { and, eq }) => and(eq(d.organizationId, ses), eq(d.key, k)) }))!),
    );
    const [inSales] = await db.insert(leads).values({ number: "L-T-1", contactName: "A", email: "a@example.com", departmentId: salesDept!.id }).returning();
    const [inHr] = await db.insert(leads).values({ number: "L-T-2", contactName: "B", email: "b@example.com", departmentId: hrDept!.id }).returning();
    await db.insert(leads).values({ number: "L-T-3", contactName: "C", email: "c@example.com" });
    const sales = await actorFor(db, "sales@ses.demo");
    const visible = (await listLeads(db, sales)).map((l) => l.number);
    expect(visible).toContain("L-T-1");
    expect(visible).toContain("L-T-3");
    expect(visible).not.toContain("L-T-2");
    await updateLeadStatus(db, sales, inSales!.id, "contacted");
    await expect(updateLeadStatus(db, sales, inHr!.id, "contacted")).rejects.toMatchObject({ code: "forbidden" });
    // An unscoped executive sees everything.
    expect((await listLeads(db, await actorFor(db, "exec@ses.demo"))).map((l) => l.number)).toContain("L-T-2");
  });
});

describe("permission changes", () => {
  it("privileged grants need a second administrator; nobody approves their own change", async () => {
    const admin = await actorFor(db, "admin@ses.demo");
    const companyAdmin = await actorFor(db, "company.admin@ses.demo");
    const [target] = await db.select().from(users).where(eq(users.email, "support@ses.demo"));
    const [financeSet] = await db.select().from(permissionSets).where(eq(permissionSets.key, "finance_officer"));
    await expect(assignRole(db, admin, { userId: admin.userId, permissionSetId: financeSet!.id })).rejects.toThrow(/own permissions/);
    const res = await assignRole(db, admin, { userId: target!.id, permissionSetId: financeSet!.id });
    expect(res.applied).toBe(false);
    const [req] = await db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, target!.id));
    await expect(decideApproval(db, admin, req!.id, true, "")).rejects.toThrow(/own request/);
    await decideApproval(db, companyAdmin, req!.id, true, "ok");
    const supportActor = await actorFor(db, "support@ses.demo");
    expect(supportActor.grants.some((g) => g.permissions.has("finance.write"))).toBe(true);
  });

  it("refuses to give a customer user an operator permission set", async () => {
    const admin = await actorFor(db, "admin@ses.demo");
    const [cust] = await db.select().from(users).where(eq(users.email, "admin@customer-b.demo"));
    const [salesSet] = await db.select().from(permissionSets).where(eq(permissionSets.key, "sales_officer"));
    await expect(assignRole(db, admin, { userId: cust!.id, permissionSetId: salesSet!.id })).rejects.toThrow(/operator organisations/);
  });
});
