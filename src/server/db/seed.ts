import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "./client";
import {
  categories,
  currencies,
  departments,
  kbArticles,
  integrationConnections,
  leads,
  organizations,
  permissionSets,
  products,
  productVariants,
  quotes,
  roleAssignments,
  stockLevels,
  stockLocations,
  taxRates,
  users,
} from "./schema";
import { ROLE_TEMPLATES } from "../authz/roles";
import { hashPassword } from "../auth/password";
import { encryptSecret, randomToken } from "../lib/crypto";
import { DEFAULT_OWNERSHIP, DEFAULT_PRICE_RULE } from "../modules/integrations/manage";
import { loadActor } from "../auth/service";
import { createQuote, sendQuote, submitQuote } from "../modules/sales";

export const DEPARTMENTS: [string, string][] = [
  ["executive", "Executive Management & Administration"],
  ["sales", "Sales, Business Development & Account Management"],
  ["marketing", "Marketing & Communications"],
  ["finance", "Finance & Accounting"],
  ["procurement", "Procurement, Inventory, Warehousing & Logistics"],
  ["engineering", "Software Engineering, Product Development & QA"],
  ["architecture", "Enterprise Architecture, Cloud & Infrastructure"],
  ["network", "Telecommunications & Network Operations"],
  ["security", "Cybersecurity, Risk & Compliance"],
  ["delivery", "Project Management & Service Delivery"],
  ["support", "Customer Support & Managed Services"],
  ["hr", "Human Resources"],
  ["partnerships", "Partnerships & Vendor Management"],
  ["analytics", "Data Analytics & Business Intelligence"],
];

/**
 * Seeded demo accounts: [email, name, org key, role key, department scope?].
 * A department scope limits a grant to that department's records (leads, quotations);
 * only roles that work department-tagged records are scoped.
 */
export const DEMO_USERS: [string, string, "ses" | "kingsview" | "custA" | "custB", string, string?][] = [
  ["admin@ses.demo", "Ama Mensah (Platform Admin)", "ses", "platform_admin"],
  ["company.admin@ses.demo", "Kofi Boateng (Company Admin)", "ses", "company_admin"],
  ["exec@ses.demo", "Efua Asante (Executive)", "ses", "executive"],
  ["finance@ses.demo", "Yaw Owusu (Finance)", "ses", "finance_officer"],
  ["sales.manager@ses.demo", "Abena Darko (Sales Manager)", "ses", "department_manager", "sales"],
  ["sales@ses.demo", "Kwame Addo (Sales)", "ses", "sales_officer", "sales"],
  ["procurement@ses.demo", "Akosua Frimpong (Procurement)", "ses", "procurement_officer"],
  ["warehouse@ses.demo", "Kojo Antwi (Warehouse)", "ses", "warehouse_officer"],
  ["engineer@ses.demo", "Esi Quaye (Engineer)", "ses", "engineer"],
  ["netops@ses.demo", "Nana Agyeman (Network Ops)", "ses", "network_operator"],
  ["support@ses.demo", "Adwoa Ofori (Support)", "ses", "support_agent"],
  ["hr@ses.demo", "Kwesi Appiah (HR)", "ses", "hr_officer"],
  ["integrations@ses.demo", "Afia Badu (Integrations)", "ses", "integration_manager"],
  ["auditor@ses.demo", "Selorm Tetteh (Auditor)", "ses", "auditor"],
  ["partner.admin@kingsview.demo", "KingsView Partner Admin (demo account)", "kingsview", "partner_admin"],
  ["partner.staff@kingsview.demo", "KingsView Partner Staff (demo account)", "kingsview", "partner_staff"],
  ["buyer.admin@customer-a.demo", "Customer A Administrator", "custA", "customer_admin"],
  ["buyer@customer-a.demo", "Customer A User", "custA", "customer_user"],
  ["admin@customer-b.demo", "Customer B Administrator", "custB", "customer_admin"],
];

async function upsertOrg(db: DB, values: typeof organizations.$inferInsert) {
  const [existing] = await db.select().from(organizations).where(eq(organizations.slug, values.slug));
  if (existing) return existing;
  const [row] = await db.insert(organizations).values(values).returning();
  return row!;
}

export interface SeedOptions {
  demoPassword: string;
  appUrl: string;
  /** Plaintext inbound secret for the simulator connection (from .env.local). */
  kingsviewSimSecret?: string;
  simulatorsEnabled?: boolean;
  /** Skip demo transactions (quotes, leads); used by tests. */
  withDemoActivity?: boolean;
}

/**
 * Reference data needed in every environment, including production: currencies, the operator
 * organisation, the first partner organisation, departments and system permission sets. Idempotent.
 */
export async function seedReference(db: DB) {
  await db
    .insert(currencies)
    .values([
      { code: "GHS", name: "Ghana cedi", symbol: "GH₵" },
      { code: "USD", name: "US dollar", symbol: "$" },
      { code: "EUR", name: "Euro", symbol: "€", active: false },
    ])
    .onConflictDoNothing();

  const ses = await upsertOrg(db, { type: "operator", name: "Synclytics Enterprise Systems", slug: "ses" });
  if (ses.name !== "Synclytics Enterprise Systems") await db.update(organizations).set({ name: "Synclytics Enterprise Systems" }).where(eq(organizations.id, ses.id));
  const kingsview = await upsertOrg(db, {
    type: "partner",
    name: "KingsView Solutions",
    slug: "kingsview",
    socialLinks: { instagram: "https://www.instagram.com/kinxview/", facebook: "https://www.facebook.com/kinxview/" },
  });
  for (const [key, name] of DEPARTMENTS) {
    await db.insert(departments).values({ organizationId: ses.id, key, name }).onConflictDoNothing();
  }
  const depts = await db.select().from(departments).where(eq(departments.organizationId, ses.id));

  // Starter help articles about using the customer portal. Inserted once by slug; edits in the app are kept.
  const STARTER_ARTICLES = [
    {
      slug: "how-to-report-a-problem",
      title: "How to report a problem and what happens next",
      summary: "Raise a support ticket in the portal and follow it to resolution.",
      category: "how-to",
      body: "Sign in to the customer portal and open Support, then choose Report a problem.\n\nGive a short subject, describe what is happening (when it started, who is affected and any error messages) and choose how serious it is. If the problem is with equipment we supplied, pick it from the list.\n\nThe ticket page shows when we aim to respond. Our replies appear on the ticket and you are notified. If we ask you a question, the clock pauses until you reply.\n\nWhen we mark a ticket resolved, reply if the problem is not fixed and the ticket reopens. Resolved tickets close automatically after a week.",
    },
    {
      slug: "how-to-pay-an-invoice",
      title: "How to view and pay an invoice",
      summary: "Find your invoices, print them and pay online or by transfer.",
      category: "billing",
      body: "Open Invoices in the customer portal to see every invoice, what has been paid and what is outstanding.\n\nOpen an invoice to print it or save it as a PDF. Where online payment is available, choose Pay to pay the balance by card or mobile money; the invoice updates once the payment is confirmed.\n\nTo pay by bank transfer or mobile money transfer, use the payment details printed on the invoice and quote the invoice number as your reference. Our finance team records the payment when it arrives.",
    },
    {
      slug: "subscription-renewals",
      title: "How subscription renewals work",
      summary: "Renewal invoices, automatic renewal and what happens if a renewal is not paid.",
      category: "billing",
      body: "Subscriptions are listed under Subscriptions in the customer portal with the dates of the current period.\n\nBefore a period ends we issue a renewal invoice. Paying it extends the subscription for another period. If the renewal is not paid within the grace period after the end date, the subscription lapses.\n\nYour organisation's administrator can stop automatic renewal at any time; the subscription then ends at the end of the current period.",
    },
  ];
  for (const a of STARTER_ARTICLES) {
    await db.insert(kbArticles).values({ ...a, audience: "customers", status: "published", publishedAt: new Date() }).onConflictDoNothing();
  }

  // System permission sets stay in sync with code on every seed.
  for (const r of ROLE_TEMPLATES) {
    const [existing] = await db
      .select()
      .from(permissionSets)
      .where(and(eq(permissionSets.key, r.key), isNull(permissionSets.organizationId)));
    if (existing) {
      await db.update(permissionSets).set({ name: r.name, description: r.description, permissions: r.permissions, domain: r.domain }).where(eq(permissionSets.id, existing.id));
    } else {
      await db.insert(permissionSets).values({ key: r.key, name: r.name, description: r.description, permissions: r.permissions, domain: r.domain, isSystem: true });
    }
  }
  const sets = await db.select().from(permissionSets).where(isNull(permissionSets.organizationId));

  // Ghana standard rates under the VAT Act, 2025 (Act 1151), effective 1 January 2026: VAT 15%,
  // NHIL 2.5%, GETFund 2.5% — all on the same invoice value (not compounded), ~20% in total.
  // Editable in Company settings; only inserted when no taxes exist, so admin changes are kept.
  const STANDARD_TAXES = [
    { code: "VAT", name: "VAT (15%)", rateBp: 1500, sortOrder: 1 },
    { code: "NHIL", name: "NHIL (2.5%)", rateBp: 250, sortOrder: 2 },
    { code: "GETFUND", name: "GETFund levy (2.5%)", rateBp: 250, sortOrder: 3 },
  ];
  const existingTaxes = await db.select().from(taxRates).where(eq(taxRates.organizationId, ses.id));
  if (existingTaxes.length === 0) {
    await db.insert(taxRates).values(STANDARD_TAXES.map((t) => ({ ...t, organizationId: ses.id })));
  } else {
    // Upgrade earlier demo-labelled rows to the standard definitions.
    for (const t of existingTaxes.filter((x) => x.isDemo)) {
      const std = STANDARD_TAXES.find((s) => s.code === t.code);
      if (std) await db.update(taxRates).set({ ...std, compound: false, isDemo: false }).where(eq(taxRates.id, t.id));
    }
  }
  return { ses, kingsview, depts, sets };
}

/** Reference data plus demonstration accounts, customers, catalogue and taxes. Never for production. */
export async function seed(db: DB, opts: SeedOptions) {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demonstration data in production.");
  const { ses, kingsview, depts, sets } = await seedReference(db);
  const custA = await upsertOrg(db, { type: "customer", name: "Accra Demo Logistics Ltd", slug: "demo-customer-a", isDemo: true });
  const custB = await upsertOrg(db, { type: "customer", name: "Kumasi Demo Clinic", slug: "demo-customer-b", isDemo: true });
  const orgs = { ses, kingsview, custA, custB };

  const passwordHash = await hashPassword(opts.demoPassword);
  const userIds: Record<string, string> = {};
  for (const [email, name, orgKey, roleKey, deptKey] of DEMO_USERS) {
    const org = orgs[orgKey];
    let [u] = await db.select().from(users).where(eq(users.email, email));
    if (!u) [u] = await db.insert(users).values({ email, name, organizationId: org.id, passwordHash, isDemo: true }).returning();
    userIds[email] = u!.id;
    const set = sets.find((s) => s.key === roleKey)!;
    await db
      .insert(roleAssignments)
      .values({ userId: u!.id, permissionSetId: set.id, organizationId: org.id, departmentId: deptKey ? depts.find((d) => d.key === deptKey)!.id : null })
      .onConflictDoNothing();
  }

  // Catalogue (SES-owned demonstration listings)
  const cats: [string, string][] = [
    ["networking", "Networking"],
    ["computing", "Computing & servers"],
    ["software", "Software & licences"],
    ["managed-services", "Managed services"],
    ["professional-services", "Professional services"],
    ["security", "Security"],
  ];
  for (const [i, [slug, name]] of cats.entries()) await db.insert(categories).values({ slug, name, sortOrder: i }).onConflictDoNothing();
  const catRows = await db.select().from(categories);
  const cat = (slug: string) => catRows.find((c) => c.slug === slug)!.id;

  let [warehouse] = await db.select().from(stockLocations).where(eq(stockLocations.code, "ACC-MAIN"));
  if (!warehouse) [warehouse] = await db.insert(stockLocations).values({ code: "ACC-MAIN", name: "Accra main warehouse", organizationId: ses.id }).returning();

  type V = { sku: string; name: string; price: number; tracks?: boolean; period?: "month" | "year"; stock?: number };
  const catalogue: { slug: string; name: string; summary: string; type: "hardware" | "software_licence" | "subscription" | "service_package"; cat: string; variants: V[] }[] = [
    { slug: "business-laptop-14", name: "Business laptop 14-inch", summary: "Durable business laptop with 3-year warranty option. Demonstration listing.", type: "hardware", cat: "computing", variants: [
      { sku: "SES-LAP14-I5-16", name: "Core i5 · 16 GB · 512 GB SSD", price: 1_250_000, stock: 18 },
      { sku: "SES-LAP14-I7-32", name: "Core i7 · 32 GB · 1 TB SSD", price: 1_780_000, stock: 4 },
    ] },
    { slug: "rack-server-1u", name: "1U rack server", summary: "Entry rack server for branch and SME workloads. Demonstration listing.", type: "hardware", cat: "computing", variants: [
      { sku: "SES-SRV1U-STD", name: "Dual PSU · 64 GB · 2×1.92 TB", price: 4_850_000, stock: 2 },
    ] },
    { slug: "office-suite-licence", name: "Office productivity suite licence", summary: "Per-user annual licence with e-mail and file storage. Demonstration listing.", type: "software_licence", cat: "software", variants: [
      { sku: "SES-OFFICE-USR-Y", name: "Per user · annual", price: 165_000, tracks: false, period: "year" },
    ] },
    { slug: "managed-backup", name: "Managed backup & recovery", summary: "Encrypted off-site backup with monitored restores. Demonstration listing.", type: "subscription", cat: "managed-services", variants: [
      { sku: "SES-BKP-1TB-M", name: "1 TB · monthly", price: 120_000, tracks: false, period: "month" },
      { sku: "SES-BKP-5TB-M", name: "5 TB · monthly", price: 480_000, tracks: false, period: "month" },
    ] },
    { slug: "network-monitoring", name: "Network monitoring (per site)", summary: "24/7 monitoring of links, switches and firewalls with alerting. Demonstration listing.", type: "subscription", cat: "managed-services", variants: [
      { sku: "SES-NMON-SITE-M", name: "Per site · monthly", price: 85_000, tracks: false, period: "month" },
    ] },
    { slug: "it-infrastructure-assessment", name: "IT infrastructure assessment", summary: "Two-week review of network, servers, backup and security with a prioritised roadmap. Demonstration listing.", type: "service_package", cat: "professional-services", variants: [
      { sku: "SES-SVC-ITA-STD", name: "Up to 50 users", price: 2_400_000, tracks: false },
    ] },
    { slug: "erp-discovery-workshop", name: "ERP discovery workshop", summary: "Process mapping and fit-gap analysis before ERP, POS or inventory rollout. Demonstration listing.", type: "service_package", cat: "professional-services", variants: [
      { sku: "SES-SVC-ERP-DISC", name: "3-day workshop", price: 1_800_000, tracks: false },
    ] },
    { slug: "cybersecurity-readiness-review", name: "Cybersecurity readiness review", summary: "Controls review, vulnerability scan and remediation plan. Demonstration listing.", type: "service_package", cat: "security", variants: [
      { sku: "SES-SVC-CYB-RR", name: "Standard scope", price: 3_200_000, tracks: false },
    ] },
  ];
  for (const p of catalogue) {
    let [prod] = await db.select().from(products).where(eq(products.slug, p.slug));
    if (!prod) [prod] = await db.insert(products).values({ slug: p.slug, name: p.name, summary: p.summary, description: p.summary, type: p.type, categoryId: cat(p.cat), status: "active", isDemo: true }).returning();
    for (const v of p.variants) {
      let [variant] = await db.select().from(productVariants).where(eq(productVariants.sku, v.sku));
      if (!variant) {
        [variant] = await db
          .insert(productVariants)
          .values({ productId: prod!.id, sku: v.sku, name: v.name, priceMinor: v.price, currency: "GHS", tracksStock: v.tracks ?? true, billingPeriod: v.period ?? null })
          .returning();
        if (v.stock !== undefined) await db.insert(stockLevels).values({ variantId: variant!.id, locationId: warehouse!.id, onHand: v.stock });
      }
    }
  }

  // KingsView: simulator connection only (no real API exists yet).
  if (opts.simulatorsEnabled && opts.kingsviewSimSecret) {
    const [existing] = await db.select().from(integrationConnections).where(and(eq(integrationConnections.partnerOrgId, kingsview.id), eq(integrationConnections.mode, "simulator")));
    if (!existing) {
      await db.insert(integrationConnections).values({
        partnerOrgId: kingsview.id,
        name: "KingsView Solutions (SIMULATOR)",
        mode: "simulator",
        inboundSecretEnc: encryptSecret(opts.kingsviewSimSecret),
        outboundUrl: `${opts.appUrl}/api/simulators/kingsview/inbox`,
        outboundSecretEnc: encryptSecret(`whsec_${randomToken(32)}`),
        defaultFieldOwnership: DEFAULT_OWNERSHIP,
        defaultPriceRule: DEFAULT_PRICE_RULE,
      });
    }
  }

  if (opts.withDemoActivity) {
    const [anyLead] = await db.select({ id: leads.id }).from(leads).limit(1);
    if (!anyLead) {
      const sales = depts.find((d) => d.key === "sales")!.id;
      await db.insert(leads).values([
        { number: "L-DEMO-00001", contactName: "Demo Contact One", email: "contact1@example.com", companyName: "Demo Retail Group", serviceInterest: "POS & inventory", message: "Demonstration enquiry: 6 branches need POS and central inventory.", departmentId: sales, isDemo: true },
        { number: "L-DEMO-00002", contactName: "Demo Contact Two", email: "contact2@example.com", companyName: "Demo Polytechnic", serviceInterest: "Network & Wi-Fi", message: "Demonstration enquiry: campus Wi-Fi upgrade and monitoring.", departmentId: sales, status: "qualified", isDemo: true },
      ]);
    }
    const [anyQuote] = await db.select({ id: quotes.id }).from(quotes).limit(1);
    if (!anyQuote) {
      const actor = (await loadActor(db, userIds["sales@ses.demo"]!, { id: "seed", mfaVerified: false }))!;
      const laptop = (await db.select().from(productVariants).where(eq(productVariants.sku, "SES-LAP14-I5-16")))[0]!;
      const backup = (await db.select().from(productVariants).where(eq(productVariants.sku, "SES-BKP-1TB-M")))[0]!;
      const q = await createQuote(db, actor, {
        customerOrgId: custA.id,
        discountBp: 500,
        notes: "Demonstration quotation.",
        lines: [
          { variantId: laptop.id, quantity: 2 },
          { variantId: backup.id, quantity: 1 },
        ],
      });
      await submitQuote(db, actor, q.id);
      await sendQuote(db, actor, q.id);
      await db.update(quotes).set({ isDemo: true }).where(eq(quotes.id, q.id));
    }
  }
  return { organizations: orgs, userIds };
}
