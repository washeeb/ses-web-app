import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Compatibility: the production host runs PostgreSQL older than 15 (and possibly older than 13),
// so IDs are generated in the app rather than with gen_random_uuid(), and no PG15-only syntax is used.
const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());
const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
/** Money is stored as integer minor units (e.g. pesewas). */
const money = (name: string) => bigint(name, { mode: "number" });

// ───────────────────────────── Organisations & identity ─────────────────────────────

export const orgType = pgEnum("org_type", ["operator", "customer", "partner"]);

export const organizations = pgTable("organizations", {
  id: id(),
  type: orgType("type").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("active"),
  website: text("website"),
  socialLinks: jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const departments = pgTable(
  "departments",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.organizationId, t.key)],
);

export const users = pgTable("users", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  status: text("status").notNull().default("active"),
  mfaSecretEnc: text("mfa_secret_enc"),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaLastStep: bigint("mfa_last_step", { mode: "number" }),
  failedLogins: integer("failed_logins").notNull().default(0),
  lockedUntil: ts("locked_until"),
  passwordChangedAt: ts("password_changed_at"),
  lastLoginAt: ts("last_login_at"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index().on(t.userId)],
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

export const permissionSets = pgTable("permission_sets", {
  id: id(),
  /** null = system template available to every organisation of the matching domain */
  organizationId: uuid("organization_id").references(() => organizations.id),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  domain: orgType("domain").notNull(),
  permissions: text("permissions").array().notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAt(),
});

export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    permissionSetId: uuid("permission_set_id").notNull().references(() => permissionSets.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    departmentId: uuid("department_id").references(() => departments.id),
    grantedBy: uuid("granted_by").references(() => users.id),
    createdAt: createdAt(),
  },
  // One grant per user/set/organisation/department; NULL department treated as a value (works before PostgreSQL 15).
  (t) => [
    uniqueIndex("role_assignments_unique").on(
      t.userId,
      t.permissionSetId,
      t.organizationId,
      sql`coalesce(${t.departmentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
  ],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

export const sequences = pgTable("sequences", {
  key: text("key").primaryKey(),
  value: integer("value").notNull().default(0),
});

// ───────────────────────────── Settings & audit ─────────────────────────────

export const settings = pgTable(
  "settings",
  {
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.key] })],
);

export const currencies = pgTable("currencies", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
  minorUnits: integer("minor_units").notNull().default(2),
  active: boolean("active").notNull().default(true),
});

export const taxRates = pgTable("tax_rates", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  /** basis points: 1500 = 15% */
  rateBp: integer("rate_bp").notNull(),
  compound: boolean("compound").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  isDemo: boolean("is_demo").notNull().default(false),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    at: ts("at").notNull().defaultNow(),
    actorUserId: uuid("actor_user_id"),
    actorOrgId: uuid("actor_org_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    data: jsonb("data").notNull().default({}),
    ip: text("ip"),
  },
  (t) => [index().on(t.at), index().on(t.targetType, t.targetId)],
);

export const mailOutbox = pgTable("mail_outbox", {
  id: id(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  adapter: text("adapter").notNull(),
  createdAt: createdAt(),
  sentAt: ts("sent_at"),
  lastError: text("last_error"),
});

// ───────────────────────────── Catalogue & inventory ─────────────────────────────

export const productType = pgEnum("product_type", ["hardware", "software_licence", "subscription", "service_package"]);

export const categories = pgTable("categories", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const products = pgTable("products", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  summary: text("summary"),
  description: text("description"),
  type: productType("type").notNull(),
  categoryId: uuid("category_id").references(() => categories.id),
  /** draft products are never shown publicly */
  status: text("status").notNull().default("draft"),
  sourceConnectionId: uuid("source_connection_id"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id),
    sku: text("sku").notNull().unique(),
    name: text("name").notNull(),
    priceMinor: money("price_minor").notNull(),
    currency: text("currency").notNull().references(() => currencies.code),
    taxable: boolean("taxable").notNull().default(true),
    /** physical items need stock; services and licences do not */
    tracksStock: boolean("tracks_stock").notNull().default(true),
    billingPeriod: text("billing_period"),
    /** Manufacturer/SES warranty from the fulfilment date; 0 = none. */
    warrantyMonths: integer("warranty_months").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("price_non_negative", sql`${t.priceMinor} >= 0`)],
);

export const stockLocations = pgTable("stock_locations", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  /** set when stock at this location is supplied by a partner connection */
  connectionId: uuid("connection_id"),
});

export const stockLevels = pgTable(
  "stock_levels",
  {
    id: id(),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    locationId: uuid("location_id").notNull().references(() => stockLocations.id),
    onHand: integer("on_hand").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    sourceVersion: bigint("source_version", { mode: "number" }).notNull().default(0),
    sourceUpdatedAt: ts("source_updated_at").notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique().on(t.variantId, t.locationId),
    check("stock_non_negative", sql`${t.onHand} >= 0 AND ${t.reserved} >= 0`),
  ],
);

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: id(),
    stockLevelId: uuid("stock_level_id").notNull().references(() => stockLevels.id),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    orderId: uuid("order_id").notNull(),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull().default("active"),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.orderId), check("reservation_qty_positive", sql`${t.quantity} > 0`)],
);

// ───────────────────────────── Sales ─────────────────────────────

export const leads = pgTable("leads", {
  id: id(),
  number: text("number").notNull().unique(),
  source: text("source").notNull().default("website"),
  contactName: text("contact_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  companyName: text("company_name"),
  serviceInterest: text("service_interest"),
  message: text("message"),
  status: text("status").notNull().default("new"),
  ownerUserId: uuid("owner_user_id").references(() => users.id),
  departmentId: uuid("department_id").references(() => departments.id),
  customerOrgId: uuid("customer_org_id").references(() => organizations.id),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const quotes = pgTable("quotes", {
  id: id(),
  number: text("number").notNull().unique(),
  customerOrgId: uuid("customer_org_id").notNull().references(() => organizations.id),
  leadId: uuid("lead_id").references(() => leads.id),
  departmentId: uuid("department_id").references(() => departments.id),
  status: text("status").notNull().default("draft"),
  currency: text("currency").notNull().references(() => currencies.code),
  subtotalMinor: money("subtotal_minor").notNull().default(0),
  discountBp: integer("discount_bp").notNull().default(0),
  discountMinor: money("discount_minor").notNull().default(0),
  taxMinor: money("tax_minor").notNull().default(0),
  totalMinor: money("total_minor").notNull().default(0),
  taxBreakdown: jsonb("tax_breakdown").$type<{ code: string; name: string; amountMinor: number }[]>().notNull().default([]),
  validUntil: ts("valid_until"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: ts("approved_at"),
  sentAt: ts("sent_at"),
  acceptedBy: uuid("accepted_by").references(() => users.id),
  acceptedAt: ts("accepted_at"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const quoteLines = pgTable("quote_lines", {
  id: id(),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id),
  variantId: uuid("variant_id").references(() => productVariants.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: money("unit_price_minor").notNull(),
  taxable: boolean("taxable").notNull().default(true),
  lineTotalMinor: money("line_total_minor").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const orders = pgTable("orders", {
  id: id(),
  number: text("number").notNull().unique(),
  customerOrgId: uuid("customer_org_id").notNull().references(() => organizations.id),
  quoteId: uuid("quote_id").references(() => quotes.id),
  /** quote (accepted quotation) | store (online checkout) */
  source: text("source").notNull().default("quote"),
  /** Customer's own purchase-order number or reference. */
  customerReference: text("customer_reference"),
  status: text("status").notNull().default("pending"),
  currency: text("currency").notNull().references(() => currencies.code),
  subtotalMinor: money("subtotal_minor").notNull(),
  discountMinor: money("discount_minor").notNull().default(0),
  taxMinor: money("tax_minor").notNull(),
  totalMinor: money("total_minor").notNull(),
  taxBreakdown: jsonb("tax_breakdown").$type<{ code: string; name: string; amountMinor: number }[]>().notNull().default([]),
  createdBy: uuid("created_by").references(() => users.id),
  /** unpaid | part_paid | paid — mirrors the order's invoice */
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  fulfilledAt: ts("fulfilled_at"),
  paidAt: ts("paid_at"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ───────────────────────────── Invoices ─────────────────────────────

/** One open (non-void) invoice per order, enforced in code under the order lock; standalone invoices have no order. */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    number: text("number").notNull().unique(),
    customerOrgId: uuid("customer_org_id").notNull().references(() => organizations.id),
    orderId: uuid("order_id").references(() => orders.id),
    /** Set on renewal invoices. */
    subscriptionId: uuid("subscription_id"),
    /** issued | part_paid | paid | void */
    status: text("status").notNull().default("issued"),
    currency: text("currency").notNull().references(() => currencies.code),
    subtotalMinor: money("subtotal_minor").notNull(),
    discountMinor: money("discount_minor").notNull().default(0),
    taxMinor: money("tax_minor").notNull(),
    totalMinor: money("total_minor").notNull(),
    taxBreakdown: jsonb("tax_breakdown").$type<{ code: string; name: string; amountMinor: number }[]>().notNull().default([]),
    paidMinor: money("paid_minor").notNull().default(0),
    customerReference: text("customer_reference"),
    notes: text("notes"),
    issuedAt: ts("issued_at").notNull().defaultNow(),
    dueAt: ts("due_at").notNull(),
    paidAt: ts("paid_at"),
    voidedAt: ts("voided_at"),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
    remindersSent: integer("reminders_sent").notNull().default(0),
    lastReminderAt: ts("last_reminder_at"),
    /** null when issued automatically (e.g. on checkout) */
    createdBy: uuid("created_by").references(() => users.id),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.customerOrgId),
    index().on(t.orderId),
    index().on(t.status, t.dueAt),
    check("invoice_paid_range", sql`${t.paidMinor} >= 0 AND ${t.paidMinor} <= ${t.totalMinor}`),
  ],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: id(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: money("unit_price_minor").notNull(),
  taxable: boolean("taxable").notNull().default(true),
  lineTotalMinor: money("line_total_minor").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * Payments. Online (provider "paystack") rows only become successful from a verified provider response;
 * manual rows (provider "manual": bank transfer, mobile money, cash, cheque) are recorded by finance staff.
 */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    orderId: uuid("order_id").references(() => orders.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    provider: text("provider").notNull(),
    /** card | mobile_money | bank_transfer | cash | cheque (manual), or the provider's channel */
    method: text("method"),
    /** Bank/MoMo transaction reference for manual payments. */
    externalReference: text("external_reference"),
    note: text("note"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    reference: text("reference").notNull().unique(),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").notNull(),
    /** initialized | success | failed | abandoned | amount_mismatch */
    status: text("status").notNull().default("initialized"),
    mode: text("mode").notNull(),
    providerTransactionId: text("provider_transaction_id"),
    channel: text("channel"),
    paidAt: ts("paid_at"),
    failureReason: text("failure_reason"),
    initiatedBy: uuid("initiated_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.orderId), index().on(t.invoiceId), check("payment_amount_positive", sql`${t.amountMinor} > 0`)],
);

export const orderLines = pgTable("order_lines", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  variantId: uuid("variant_id").references(() => productVariants.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: money("unit_price_minor").notNull(),
  taxable: boolean("taxable").notNull().default(true),
  lineTotalMinor: money("line_total_minor").notNull(),
  /** partner connection responsible for fulfilling this line, if any */
  fulfilmentConnectionId: uuid("fulfilment_connection_id"),
  fulfilmentStatus: text("fulfilment_status").notNull().default("not_started"),
  fulfilmentVersion: bigint("fulfilment_version", { mode: "number" }).notNull().default(0),
});

// ───────────────────────────── Approvals ─────────────────────────────

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    type: text("type").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("pending"),
    /** null when raised by the system (e.g. a partner price feed) */
    requestedBy: uuid("requested_by").references(() => users.id),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.status),
    check(
      "no_self_approval",
      sql`${t.decidedBy} IS NULL OR ${t.requestedBy} IS NULL OR ${t.decidedBy} <> ${t.requestedBy}`,
    ),
  ],
);

// ───────────────────────────── Integrations ─────────────────────────────

export type FieldOwnership = Record<"name" | "description" | "cost" | "stock" | "status", "partner" | "ses">;
export type PriceRule = { type: "markup"; bp: number } | { type: "fixed_margin"; minor: number };

export const integrationConnections = pgTable("integration_connections", {
  id: id(),
  partnerOrgId: uuid("partner_org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  /** simulator connections never talk to real partner systems */
  mode: text("mode").$type<"simulator" | "production">().notNull(),
  status: text("status").notNull().default("active"),
  inboundSecretEnc: text("inbound_secret_enc").notNull(),
  outboundUrl: text("outbound_url"),
  outboundSecretEnc: text("outbound_secret_enc"),
  staleAfterSeconds: integer("stale_after_seconds").notNull().default(900),
  sensitivePriceChangeBp: integer("sensitive_price_change_bp").notNull().default(1500),
  defaultFieldOwnership: jsonb("default_field_ownership").$type<FieldOwnership>().notNull(),
  defaultPriceRule: jsonb("default_price_rule").$type<PriceRule>().notNull(),
  lastEventAt: ts("last_event_at"),
  lastSyncAt: ts("last_sync_at"),
  createdAt: createdAt(),
});

export const apiCredentials = pgTable("api_credentials", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  connectionId: uuid("connection_id").references(() => integrationConnections.id),
  name: text("name").notNull(),
  prefix: text("prefix").notNull().unique(),
  keyHash: text("key_hash").notNull(),
  scopes: text("scopes").array().notNull(),
  environment: text("environment").notNull(),
  expiresAt: ts("expires_at"),
  revokedAt: ts("revoked_at"),
  lastUsedAt: ts("last_used_at"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const productMappings = pgTable(
  "product_mappings",
  {
    id: id(),
    connectionId: uuid("connection_id").notNull().references(() => integrationConnections.id),
    partnerSku: text("partner_sku").notNull(),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    fieldOwnership: jsonb("field_ownership").$type<FieldOwnership>().notNull(),
    priceRule: jsonb("price_rule").$type<PriceRule>().notNull(),
    partnerCostMinor: money("partner_cost_minor"),
    partnerCurrency: text("partner_currency"),
    sourceVersion: bigint("source_version", { mode: "number" }).notNull().default(0),
    lastSyncedAt: ts("last_synced_at"),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.connectionId, t.partnerSku)],
);

export const inboundEvents = pgTable(
  "inbound_events",
  {
    id: id(),
    connectionId: uuid("connection_id").notNull().references(() => integrationConnections.id),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    occurredAt: ts("occurred_at").notNull(),
    version: bigint("version", { mode: "number" }).notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [unique().on(t.connectionId, t.eventId), index().on(t.connectionId, t.status)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(8),
    runAt: ts("run_at").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    lastError: text("last_error"),
    dedupeKey: text("dedupe_key").unique(),
    createdAt: createdAt(),
    completedAt: ts("completed_at"),
  },
  (t) => [index().on(t.status, t.runAt)],
);

// ───────────────────────────── Procurement ─────────────────────────────

export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text("name").notNull(),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  taxId: text("tax_id"),
  paymentTermsDays: integer("payment_terms_days").notNull().default(30),
  currency: text("currency").notNull().default("GHS"),
  /** Optional link when the supplier is also an integration partner. */
  partnerOrgId: uuid("partner_org_id").references(() => organizations.id),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const purchaseOrders = pgTable("purchase_orders", {
  id: id(),
  number: text("number").notNull().unique(),
  supplierId: uuid("supplier_id").notNull().references(() => suppliers.id),
  /** draft | pending_approval | approved | rejected | sent | partially_received | received | cancelled */
  status: text("status").notNull().default("draft"),
  currency: text("currency").notNull(),
  totalMinor: money("total_minor").notNull().default(0),
  locationId: uuid("location_id").notNull().references(() => stockLocations.id),
  expectedAt: ts("expected_at"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: ts("approved_at"),
  sentAt: ts("sent_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: id(),
    purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unitCostMinor: money("unit_cost_minor").notNull(),
    lineTotalMinor: money("line_total_minor").notNull(),
    receivedQuantity: integer("received_quantity").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    check("po_line_qty_positive", sql`${t.quantity} > 0`),
    check("po_line_received_range", sql`${t.receivedQuantity} >= 0 AND ${t.receivedQuantity} <= ${t.quantity}`),
  ],
);

export const goodsReceipts = pgTable("goods_receipts", {
  id: id(),
  number: text("number").notNull().unique(),
  purchaseOrderId: uuid("purchase_order_id").notNull().references(() => purchaseOrders.id),
  locationId: uuid("location_id").notNull().references(() => stockLocations.id),
  receivedBy: uuid("received_by").notNull().references(() => users.id),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: id(),
  goodsReceiptId: uuid("goods_receipt_id").notNull().references(() => goodsReceipts.id),
  purchaseOrderLineId: uuid("purchase_order_line_id").notNull().references(() => purchaseOrderLines.id),
  quantity: integer("quantity").notNull(),
});

/** Ledger of every change to SES-managed stock (partner stock is owned by the partner feed). */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    locationId: uuid("location_id").notNull().references(() => stockLocations.id),
    /** Signed change to on-hand quantity. */
    quantity: integer("quantity").notNull(),
    /** receipt | adjustment | fulfilment | return */
    reason: text("reason").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    note: text("note"),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.variantId, t.createdAt)],
);

// ───────────────────────────── Documents ─────────────────────────────

export const documents = pgTable(
  "documents",
  {
    id: id(),
    /** Organisation the record belongs to (customer org for customer-facing records, operator org otherwise). */
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    /** order | quote | purchase_order | supplier */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    /** Random name on disk; never derived from user input. */
    storageKey: text("storage_key").notNull().unique(),
    /** internal: SES staff only; customer: also visible to the customer organisation */
    visibility: text("visibility").notNull().default("internal"),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    deletedAt: ts("deleted_at"),
    deletedBy: uuid("deleted_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.entityType, t.entityId)],
);

// ───────────────────────────── After-sales ─────────────────────────────

/** Created when an order is fulfilled, for lines whose product carries a warranty. */
export const warranties = pgTable(
  "warranties",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    orderLineId: uuid("order_line_id").notNull().references(() => orderLines.id),
    customerOrgId: uuid("customer_org_id").notNull().references(() => organizations.id),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    quantity: integer("quantity").notNull(),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.customerOrgId)],
);

/** Return / warranty claim (RMA). */
export const returnRequests = pgTable(
  "return_requests",
  {
    id: id(),
    number: text("number").notNull().unique(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    customerOrgId: uuid("customer_org_id").notNull().references(() => organizations.id),
    /** return (change of mind / wrong item, within the return window) | warranty (fault under warranty) */
    kind: text("kind").notNull(),
    /** refund | replacement | repair */
    resolution: text("resolution").notNull(),
    reason: text("reason").notNull(),
    /** requested | approved | rejected | received | refund_pending | completed | cancelled */
    status: text("status").notNull().default("requested"),
    requestedBy: uuid("requested_by").notNull().references(() => users.id),
    decidedBy: uuid("decided_by").references(() => users.id),
    decisionNote: text("decision_note"),
    receivedBy: uuid("received_by").references(() => users.id),
    receivedAt: ts("received_at"),
    restocked: boolean("restocked").notNull().default(false),
    refundMinor: money("refund_minor"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.customerOrgId), index().on(t.status)],
);

export const returnLines = pgTable("return_lines", {
  id: id(),
  returnId: uuid("return_id").notNull().references(() => returnRequests.id),
  orderLineId: uuid("order_line_id").notNull().references(() => orderLines.id),
  variantId: uuid("variant_id").references(() => productVariants.id),
  quantity: integer("quantity").notNull(),
});

// ───────────────────────────── Notifications ─────────────────────────────

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    body: text("body"),
    /** Relative link inside the app. */
    link: text("link"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.readAt)],
);

// ───────────────────────────── Subscriptions & service contracts ─────────────────────────────

/** Recurring products (variants with a billing period). Renewal: T-notice → renewal invoice → paid = renewed, unpaid past grace = lapsed. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    number: text("number").notNull().unique(),
    customerOrgId: uuid("customer_org_id").notNull().references(() => organizations.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: money("unit_price_minor").notNull(),
    currency: text("currency").notNull().references(() => currencies.code),
    taxable: boolean("taxable").notNull().default(true),
    /** month | year */
    billingPeriod: text("billing_period").notNull(),
    /** active | ended | lapsed | cancelled */
    status: text("status").notNull().default("active"),
    autoRenew: boolean("auto_renew").notNull().default(true),
    currentPeriodStart: ts("current_period_start").notNull(),
    currentPeriodEnd: ts("current_period_end").notNull(),
    /** Open renewal invoice for the next period, if issued. */
    renewalInvoiceId: uuid("renewal_invoice_id"),
    sourceOrderId: uuid("source_order_id").references(() => orders.id),
    sourceOrderLineId: uuid("source_order_line_id").references(() => orderLines.id),
    endedAt: ts("ended_at"),
    endReason: text("end_reason"),
    createdBy: uuid("created_by").references(() => users.id),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.customerOrgId), index().on(t.status, t.currentPeriodEnd), check("subscription_qty_positive", sql`${t.quantity} > 0`)],
);

export type SlaTargets = Record<"urgent" | "high" | "normal" | "low", { responseMinutes: number; resolutionMinutes: number }>;

/** Support terms for a customer: coverage hours and response/resolution targets per priority. */
export const serviceContracts = pgTable(
  "service_contracts",
  {
    id: id(),
    number: text("number").notNull().unique(),
    customerOrgId: uuid("customer_org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    /** business_hours (Mon–Fri 08:00–17:00 Accra) | 24x7 */
    coverage: text("coverage").notNull().default("business_hours"),
    slaTargets: jsonb("sla_targets").$type<SlaTargets>().notNull(),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    /** active | cancelled (expiry is derived from ends_at) */
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.customerOrgId), check("contract_dates", sql`${t.endsAt} > ${t.startsAt}`)],
);

// ───────────────────────────── Assets ─────────────────────────────

/** Installed base: equipment SES supplied or supports for a customer. */
export const assets = pgTable(
  "assets",
  {
    id: id(),
    tag: text("tag").notNull().unique(),
    customerOrgId: uuid("customer_org_id").notNull().references(() => organizations.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    name: text("name").notNull(),
    serialNumber: text("serial_number"),
    location: text("location"),
    /** active | in_repair | retired */
    status: text("status").notNull().default("active"),
    orderId: uuid("order_id").references(() => orders.id),
    orderLineId: uuid("order_line_id").references(() => orderLines.id),
    contractId: uuid("contract_id").references(() => serviceContracts.id),
    installedAt: ts("installed_at"),
    notes: text("notes"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.customerOrgId), index().on(t.serialNumber)],
);

// ───────────────────────────── Support tickets ─────────────────────────────

export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    number: text("number").notNull().unique(),
    customerOrgId: uuid("customer_org_id").notNull().references(() => organizations.id),
    contractId: uuid("contract_id").references(() => serviceContracts.id),
    assetId: uuid("asset_id").references(() => assets.id),
    subject: text("subject").notNull(),
    /** low | normal | high | urgent */
    priority: text("priority").notNull().default("normal"),
    category: text("category").notNull().default("general"),
    /** new | open | pending_customer | resolved | closed */
    status: text("status").notNull().default("new"),
    /** 1 = first line, 2 = second line, 3 = engineering */
    level: integer("level").notNull().default(1),
    coverage: text("coverage").notNull(),
    requesterUserId: uuid("requester_user_id").notNull().references(() => users.id),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id),
    responseDueAt: ts("response_due_at").notNull(),
    resolutionDueAt: ts("resolution_due_at").notNull(),
    firstRespondedAt: ts("first_responded_at"),
    responseBreached: boolean("response_breached").notNull().default(false),
    resolutionBreached: boolean("resolution_breached").notNull().default(false),
    /** Set while waiting on the customer: the resolution clock is paused. */
    pausedAt: ts("paused_at"),
    resolvedAt: ts("resolved_at"),
    closedAt: ts("closed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.customerOrgId), index().on(t.status), check("ticket_level_range", sql`${t.level} BETWEEN 1 AND 3`)],
);

export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: id(),
    ticketId: uuid("ticket_id").notNull().references(() => tickets.id),
    authorUserId: uuid("author_user_id").references(() => users.id),
    body: text("body").notNull(),
    /** Internal notes are never shown to the customer. */
    internal: boolean("internal").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.ticketId, t.createdAt)],
);

// ───────────────────────────── Projects ─────────────────────────────

export const projects = pgTable(
  "projects",
  {
    id: id(),
    number: text("number").notNull().unique(),
    /** null for internal projects */
    customerOrgId: uuid("customer_org_id").references(() => organizations.id),
    orderId: uuid("order_id").references(() => orders.id),
    name: text("name").notNull(),
    description: text("description"),
    /** planning | active | on_hold | completed | cancelled */
    status: text("status").notNull().default("planning"),
    managerUserId: uuid("manager_user_id").notNull().references(() => users.id),
    startDate: ts("start_date"),
    dueDate: ts("due_date"),
    completedAt: ts("completed_at"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.customerOrgId), index().on(t.status)],
);

export const projectMilestones = pgTable(
  "project_milestones",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    name: text("name").notNull(),
    dueDate: ts("due_date"),
    /** open | awaiting_signoff | signed_off */
    status: text("status").notNull().default("open"),
    signoffRequestedBy: uuid("signoff_requested_by").references(() => users.id),
    signoffRequestedAt: ts("signoff_requested_at"),
    signedOffBy: uuid("signed_off_by").references(() => users.id),
    signedOffAt: ts("signed_off_at"),
    /** Last sign-off decision note (approval comment or reason for rejection). */
    signoffNote: text("signoff_note"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.projectId),
    check("milestone_no_self_signoff", sql`${t.signedOffBy} IS NULL OR ${t.signoffRequestedBy} IS NULL OR ${t.signedOffBy} <> ${t.signoffRequestedBy}`),
  ],
);

export const projectTasks = pgTable(
  "project_tasks",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id),
    milestoneId: uuid("milestone_id").references(() => projectMilestones.id),
    title: text("title").notNull(),
    /** todo | in_progress | done */
    status: text("status").notNull().default("todo"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id),
    dueDate: ts("due_date"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.projectId)],
);

// ───────────────────────────── Knowledge base ─────────────────────────────

export const kbArticles = pgTable(
  "kb_articles",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary"),
    body: text("body").notNull(),
    category: text("category").notNull().default("general"),
    /** public (website) | customers (signed-in customers and staff) | internal (staff only) */
    audience: text("audience").notNull().default("customers"),
    /** draft | published */
    status: text("status").notNull().default("draft"),
    updatedBy: uuid("updated_by").references(() => users.id),
    publishedAt: ts("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.status, t.audience),
    index("kb_articles_search").using("gin", sql`to_tsvector('english', ${t.title} || ' ' || coalesce(${t.summary}, '') || ' ' || ${t.body})`),
  ],
);

// ───────────────────────────── AI assistance ─────────────────────────────

/** One row per AI call: for daily limits, audit and showing the result. Prompts are not stored. */
export const aiRequests = pgTable(
  "ai_requests",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    feature: text("feature").notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** ok | error */
    status: text("status").notNull(),
    output: jsonb("output"),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.userId, t.createdAt), index().on(t.subjectType, t.subjectId)],
);
