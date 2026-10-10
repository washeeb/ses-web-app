import { sql } from "drizzle-orm";
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
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
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
  (t) => [unique().on(t.userId, t.permissionSetId, t.organizationId, t.departmentId).nullsNotDistinct()],
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
  status: text("status").notNull().default("pending"),
  currency: text("currency").notNull().references(() => currencies.code),
  subtotalMinor: money("subtotal_minor").notNull(),
  discountMinor: money("discount_minor").notNull().default(0),
  taxMinor: money("tax_minor").notNull(),
  totalMinor: money("total_minor").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  paidAt: ts("paid_at"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Online payment attempts. Status is only ever set from a verified provider response. */
export const payments = pgTable(
  "payments",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => orders.id),
    provider: text("provider").notNull(),
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
  (t) => [index().on(t.orderId)],
);

export const orderLines = pgTable("order_lines", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  variantId: uuid("variant_id").references(() => productVariants.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceMinor: money("unit_price_minor").notNull(),
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
