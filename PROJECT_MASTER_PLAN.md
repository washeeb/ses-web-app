# Synclytics Enterprise Systems (SES) — Project Master Plan

> Living specification. Update the **Status**, **Decisions**, and **Progress log** sections as work lands.
> Last updated: 2026-10-13 · **Live: M1–M4** at https://synclyticsenterprisesystems.com · **M5 built** (catalogue, inventory, reports) — deploy waits on GitHub Actions billing · Remaining items are external (§12, §15)

---

## 1. Purpose

SES delivers practical technology solutions for businesses, institutions, and partner companies. This platform is the single connected system for SES's public presence, commerce, customers, partners, and internal operations.

### 1.1 Service catalogue

**Core services (from the brief, presented on the public site):**

| Area | Services |
|---|---|
| Enterprise software | ERP, CRM, POS, inventory, warehouse management, business process automation |
| Software & integration | Custom software development, APIs, systems integration, data migration |
| Infrastructure | IT architecture, cloud, hybrid deployments, managed services |
| Telecoms & networks | Telecom/network solutions delivered **through partnerships** with telecom operators, ISPs and related providers |
| Connectivity & security | Connectivity, VPNs, network monitoring, cybersecurity, backup, disaster recovery |
| Hardware & licensing | Hardware supply, installation, maintenance, software licensing, subscriptions |
| Data & intelligence | Data analytics, business intelligence, applied AI and IoT |

**Proposed future offerings (marked "Proposed" in the UI, not sold until SES confirms capability):**

| Proposal | Business value |
|---|---|
| IT/cyber readiness assessments (fixed-price) | Low-friction entry product that feeds consulting and managed-service pipelines |
| Managed SOC / security monitoring retainers | Recurring revenue on top of existing cybersecurity and network monitoring |
| Data-protection compliance support (Ghana Data Protection Act, 2012 – Act 843) | Many Ghanaian organisations must register with the Data Protection Commission; advisory + tooling |
| Mobile-money & payment integration services | High local demand; reuses SES's own payment-adapter work |
| Device-as-a-Service / hardware leasing | Converts one-off hardware sales into subscriptions |
| Staff IT training & certification prep | Supports adoption of delivered systems; additional revenue line |

---

## 2. Platform structure

One Next.js application, one database, five surfaces separated by route group and enforced by server-side permissions:

| Surface | Route | Audience |
|---|---|---|
| Public website | `/`, `/services`, `/solutions`, `/partners`, `/case-studies`, `/contact` | Everyone |
| Online store | `/store` | Public browse; checkout requires a customer account |
| Customer portal | `/portal` | Customer Administrator, Customer User |
| Partner portal | `/partner` | Partner Administrator, Partner Staff |
| Internal operations | `/ops` | SES staff (department dashboards and admin) |
| Partner API | `/api/v1/*` | Partner systems (API key or signed webhook) |

All demo content is labelled **"Demonstration data"** in the UI and seeded with an `is_demo` flag where relevant.

---

## 3. Architecture

### 3.1 Technology decisions

| Concern | Choice | Reason |
|---|---|---|
| Framework | **Next.js 16 (App Router) + React 19 + TypeScript 6** | Single full-stack codebase for site, portals, ops and versioned APIs; mature hosting options |
| Styling | Tailwind CSS 4 | Fast, consistent, accessible design primitives without a heavy UI kit |
| Database | **PostgreSQL** (production) | Transactions, row locks, `SKIP LOCKED` job queue, JSONB, mature backups |
| Local/test DB | **PGlite** (Postgres compiled to WASM) | Real Postgres semantics with zero installation; isolated in-memory DB per test file |
| ORM / migrations | Drizzle ORM + drizzle-kit | SQL-transparent, typed, versioned SQL migrations |
| Validation | Zod 4 | Shared input contracts for forms, API and webhooks |
| Auth | In-house: scrypt password hashes, DB sessions (hashed tokens), TOTP MFA | Full control of MFA/lockout/audit; no external identity dependency |
| Jobs / queue | Postgres-backed job table (`FOR UPDATE SKIP LOCKED`), retries with exponential backoff, dead-letter state | No Redis needed at this scale |
| Live UI updates | Server-Sent Events over an internal event bus (in-memory; Postgres `LISTEN/NOTIFY` for multi-instance) | One-way, authenticated, proxy-friendly |
| Tests | Vitest (unit, integration and contract tests on PGlite) | Fast, TS-native |

**Modular monolith.** Business logic lives in `src/server/modules/<module>` as plain services that take `(db, actor, input)`. UI server actions and API route handlers stay thin. No microservices: a module can be extracted later if load or team boundaries demand it.

### 3.2 Layout

```
src/
  app/                 routes: (site) store portal partner ops api/v1 login account
  components/          shared UI
  server/
    db/                schema, client, migrate, seed
    auth/              passwords, sessions, TOTP, rate limiting, current actor
    authz/             permission catalogue, role templates, policy engine
    modules/           settings, audit, catalogue, sales, approvals, inventory,
                       integrations, jobs, events, notifications
    lib/               money, crypto, errors, ids
  simulators/kingsview simulated partner (never used by production connections)
scripts/               setup, worker, simulator CLI
drizzle/               SQL migrations
tests/                 vitest suites
docs/                  API contracts, runbooks
```

### 3.3 Runtime processes

| Process | Dev (PGlite) | Production (Postgres) |
|---|---|---|
| Web | `npm run dev` | `npm run build && npm start` |
| Worker (jobs, retries, stale checks) | In-process (`instrumentation.ts`, `WORKER_MODE=inline`) because PGlite allows one process | Separate `npm run worker` (`WORKER_MODE=external`) |

---

## 4. Departments, modules, and workflows

**Departments are data, modules are code.** Departments (`departments` table) are configurable organisational units per organisation. Modules (catalogue, sales, finance…) are application features gated by permissions. A department gets access to modules by assigning permission sets to its people, optionally scoped to that department. Adding a department never requires a new application.

Seeded departments: Executive Management & Administration; Sales, Business Development & Account Management; Marketing & Communications; Finance & Accounting; Procurement, Inventory, Warehousing & Logistics; Software Engineering, Product Development & QA; Enterprise Architecture, Cloud & Infrastructure; Telecommunications & Network Operations; Cybersecurity, Risk & Compliance; Project Management & Service Delivery; Customer Support & Managed Services; Human Resources; Partnerships & Vendor Management; Data Analytics & Business Intelligence.

### 4.1 Cross-department workflows

| Workflow | Path (state machine) | Phase |
|---|---|---|
| Lead-to-sale | Enquiry → Lead (new → qualified → won/lost) → Quotation → Order | M1 |
| Quotation approval | draft → pending_approval (if over threshold or discount limit) → approved/rejected → sent → accepted/declined/expired | M1 |
| Order-to-payment | order (pending → confirmed → fulfilled / cancelled / expired) + invoice issued with the order (issued → part_paid → paid / void) → payments (Paystack online, or manual bank/MoMo/cash/cheque by finance) | M1 (order) / M3a (invoice, payment) |
| Store checkout | cart (cookie: variant + qty only) → re-priced at checkout → order (source `store`) with stock reservation and invoice in one transaction; carts at/above `storeOrderLimitMinor` (default GHS 50,000) go through a quotation | M3a |
| Procurement-to-delivery | purchase request → approval → PO → goods received → stock | M2 |
| Project delivery | project (planning → active → on hold → completed / cancelled) → milestones → tasks → sign-off (customer administrator for customer projects; a second SES user for internal ones); completion needs every milestone signed off | M3b |
| Ticket escalation | ticket (new → open ⇄ pending_customer → resolved → closed) at L1 → L2 → engineering (L3); response/resolution targets from the customer's contract or the standard SLA; clock pauses while waiting on the customer; breach alerts; resolved tickets reopen on customer reply and auto-close after `ticketAutoCloseDays` | M3b |
| Subscription renewal | active → renewal invoice at T-`renewalNoticeDays` (30) → paid = next period / unpaid after `renewalGraceDays` (14) = lapsed (invoice voided); auto-renew off = ended at period end | M3b |

Controlled sharing: records carry `organization_id` and optional `department_id`. Cross-department handoffs happen through state transitions (e.g. Sales converts an approved quotation into an order that Warehouse can see), not by widening permissions.

---

## 5. Security model

### 5.1 Permission engine

- **Permission catalogue** (code: `src/server/authz/permissions.ts`): fine-grained keys such as `catalogue.write`, `quotes.approve`, `integrations.manage`. Each key has a `domain` (operator / partner / customer) and a `privileged` flag.
- **Permission sets** (DB): named bundles of permission keys. System templates are seeded for each role below; companies can create custom sets.
- **Assignments**: `(user, permission_set, organization, department?)`. Scope = organisation, optionally narrowed to one department.
- **Policy** (`authorize(actor, permission, resource)`) is checked on the server for every action and API call:
  1. The actor holds the permission through an assignment.
  2. **Organisation isolation**: partner and customer actors can only reach records of their own organisation; operator (SES) staff reach records across organisations only through operator-domain permissions.
  3. **Department restriction**: if an assignment is department-scoped, the record's `department_id` must match (or be null for shared records).
  4. **Record-level rules** in services (e.g. a requester cannot approve their own request).
- Deny by default. UI hiding is cosmetic only.

### 5.2 Role templates (seeded permission sets)

Platform Administrator, Company Administrator, Executive, Department Manager, Finance Officer, Sales Officer, Procurement Officer, Warehouse Officer, Engineer, Network Operator, Support Agent, HR Officer, Partner Administrator, Partner Staff, Customer Administrator, Customer User, Read-only Auditor. Exact mappings are defined in `src/server/authz/roles.ts`.

### 5.3 Controls

| Control | Implementation |
|---|---|
| Passwords | scrypt (N=2^15, r=8, p=1) with per-user salt; minimum 12 characters; constant-time compare |
| Sessions | 256-bit random token, only the SHA-256 hash is stored; httpOnly + Secure + SameSite=Lax cookie; 12h absolute, 30-min idle; revoked on password change |
| MFA | TOTP (RFC 6238). **Mandatory** for anyone holding a privileged permission; privileged routes are blocked until enrolled and verified in-session |
| Lockout / rate limit | Per account (5 failures → 15-minute lock) and per IP token bucket on login, reset and public forms |
| Account recovery | Single-use, hashed, 30-minute reset token; generic responses (no account enumeration); delivered through the email adapter (logged in dev) |
| CSRF | Server Actions (origin-checked by Next.js) plus a SameSite cookie; JSON APIs use bearer keys or HMAC, never cookies |
| Input validation | Zod at every boundary; parameterised SQL through Drizzle |
| Secrets | `.env` only (never committed); integration secrets encrypted at rest with AES-256-GCM using `APP_ENCRYPTION_KEY`; API keys stored as SHA-256 hashes with a visible prefix |
| Webhooks | HMAC-SHA256 over `timestamp.rawBody`, 5-minute tolerance, event-id dedupe (replay protection), constant-time compare |
| Headers | CSP, HSTS (prod), X-Frame-Options DENY, Referrer-Policy, Permissions-Policy |
| Uploads (M2) | Size/type allow-list, magic-byte sniffing, stored outside webroot, served through authorised route |
| Audit | Append-only `audit_log` (actor, action, target, before/after diff, IP, request id) for all privileged and state-changing actions |
| Approvals | High-value quotes, discounts over the limit, sensitive partner price changes, permission changes, refunds. **No self-approval** (enforced in service + DB check) |
| Dependencies | `npm audit` in CI; lockfile committed |
| Payments | Paystack webhook HMAC-SHA512 verified; amounts confirmed via Paystack verify API before marking paid |

### 5.4 Privacy, retention, incidents

- Personal data inventory and retention schedule: `docs/privacy.md` (M2). Applicable law: **Ghana Data Protection Act, 2012 (Act 843)**; SES will register with the Data Protection Commission later (decision 2026-10-10). The platform has fields for the registration number and certificate expiry (Company settings), publishes the number on the privacy notice and footer once entered, and reminds administrators when it is missing or due for renewal (certificates last two years). The platform does not claim compliance.
- Backup/restore and incident runbooks: `docs/operations.md`.

---

## 6. Data model (M1 tables)

| Table | Key fields |
|---|---|
| `organizations` | id, type (`operator`/`customer`/`partner`), name, slug, status, is_demo |
| `departments` | id, organization_id, key, name, active |
| `users` | id, organization_id, email (unique, lower), name, password_hash, status, mfa_secret_enc, mfa_enabled, failed_logins, locked_until |
| `sessions` | id, user_id, token_hash, mfa_verified, expires_at, last_seen_at, ip, user_agent |
| `password_reset_tokens` | id, user_id, token_hash, expires_at, used_at |
| `permission_sets` | id, organization_id (null = system template), key, name, permissions text[], is_system |
| `role_assignments` | id, user_id, permission_set_id, organization_id, department_id? |
| `settings` | organization_id, key, value jsonb (currency, locale, thresholds) |
| `currencies`, `tax_rates` | code/rate configuration (GHS default) |
| `audit_log` | id, at, actor_user_id, actor_org_id, action, target_type, target_id, data jsonb, ip |
| `categories`, `products`, `product_variants` | type (hardware/licence/subscription/service), SKU, price_minor, currency, status, source (`ses`/partner connection) |
| `stock_locations`, `stock_levels`, `stock_reservations` | on_hand, reserved, source_version, source_updated_at; reservations with expiry |
| `leads` | source, contact, company, service_interest, status, owner, department_id |
| `quotes`, `quote_lines` | number, customer org, status, totals (minor units), discount, valid_until, created_by |
| `orders`, `order_lines` | number, customer org, status, totals, tax_breakdown, source (`quote`/`store`), customer_reference, payment_status (`unpaid`/`part_paid`/`paid`), quote_id; lines carry `taxable` |
| `invoices`, `invoice_lines` *(M3a)* | number (INV-YYYY-NNNNN), customer org, order_id?, status, totals + tax_breakdown, paid_minor (check: 0 ≤ paid ≤ total), issued/due/paid/voided, reminders_sent |
| `payments` *(M3a changes)* | order_id? and invoice_id?, provider (`paystack`/`manual`), method, external_reference, recorded_by, status (`success`/`reversed`/…), check amount > 0 |
| `approval_requests` | type, subject, payload, requested_by, status, decided_by, reason |
| `integration_connections` | partner org, mode (`simulator`/`production`), status, inbound secret (enc), outbound url + secret (enc), stale_after_seconds, last_sync_at |
| `api_credentials` | organization_id, connection_id, prefix, key_hash, scopes[], expires_at, revoked_at |
| `product_mappings` | connection_id, partner_sku, variant_id, field_ownership jsonb, price_rule jsonb, source_version |
| `inbound_events` | connection_id, event_id (**unique per connection**), type, occurred_at, payload, status, attempts, error |
| `jobs` | type, payload, status (`queued`/`running`/`done`/`dead`), attempts, max_attempts, run_at, dedupe_key (unique), last_error |

Money is always stored as **integer minor units** (pesewas for GHS) with an explicit currency code.

---

## 7. Partner integration framework

### 7.1 Principles

- **KingsView Solutions** is the first partner. Its web application does not exist yet. Known facts only: Instagram `https://www.instagram.com/kinxview/`, Facebook `https://www.facebook.com/kinxview/`. **No KingsView API, products, prices or terms are assumed.**
- Each partner has one or more **connections**, each explicitly marked `simulator` or `production`. Simulator connections cannot be switched to production; a new production connection must be created with real credentials.
- The **KingsView simulator** (`src/simulators/kingsview`) emits clearly fake data (`SIM-` SKUs, "Simulated item" names) and is disabled unless `SIMULATORS_ENABLED=true`.

### 7.2 Contracts (v1)

Full specification: `docs/api/partner-integration-v1.md`.

**Inbound webhook (partner → SES)** `POST /api/v1/integrations/{connectionId}/events`

Headers: `SES-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`, `Content-Type: application/json`.

Envelope:
```json
{ "id": "evt_…", "type": "product.upserted", "occurred_at": "2026-10-10T09:00:00Z",
  "version": 42, "data": { … } }
```
Event types in v1: `product.upserted`, `product.retired`, `price.updated`, `stock.updated`, `order.status_changed`, `fulfilment.updated`.
Responses: `202` accepted (queued), `200` duplicate (already received), `400` invalid payload, `401` bad or expired signature, `404` unknown connection, `409` connection disabled, `429` rate limited.

**Partner API (API key, scoped)**: `GET /api/v1/partner/mappings`, `GET /api/v1/partner/fulfilment-requests`, `GET /api/v1/health`. Keys: `Authorization: Bearer ses_<env>_<prefix>_<secret>`; scopes such as `catalogue:read`, `orders:read`, `stock:write`.

**Outbound (SES → partner)**: `order.fulfilment_requested`, `order.cancelled`, signed the same way with the partner's outbound secret and delivered through the job queue with retries.

### 7.3 Processing rules

| Rule | Behaviour |
|---|---|
| Deduplication / idempotency | `(connection_id, event_id)` is unique; a duplicate returns 200 and is not reprocessed |
| Ordering | Each entity carries a monotonically increasing `version`; an event with `version <= stored source_version` is recorded as `stale_ignored` |
| Field ownership | Per mapping: e.g. `price`, `stock` → partner; `description`, `images`, `category` → SES. Fields not owned by the source are ignored |
| Price rules | Partner cost × markup rule → SES sell price. A change above `sensitive_price_change_pct` (default 15%) creates a **price-change approval** instead of applying |
| Retries | Exponential backoff with jitter (30s, 2m, 8m, 32m, 2h…); after `max_attempts` (default 8) → `dead` (dead-letter) and visible on the health dashboard with manual replay |
| Reconciliation | Scheduled full snapshot pull/import (or a partner-sent `catalogue.snapshot`) compares mappings and flags drift (M2) |
| Polling / imports | For partners without webhooks: connection `mode=polling` with interval and CSV/JSON import (M2) |
| Stale safeguards | If `now − stock.source_updated_at > stale_after_seconds` (default 15 min), the item shows "Availability to be confirmed" and **cannot be checked out** (quote request instead) |

### 7.4 Synchronisation targets (SLOs)

| Data | Target | Consistency |
|---|---|---|
| Webhook acceptance | p95 < 500 ms to `202` | — |
| Stock / price from webhook → visible in UI | p95 < 10 s | Near real-time (SSE push after commit) |
| Order status → partner | p95 < 30 s; retried up to 24 h | Eventual, guaranteed by outbox |
| Polling partners | Within one polling interval (default 5 min) | Eventual |
| Full reconciliation | Daily | Eventual; drift reported |

### 7.5 Overselling prevention

1. Availability = Σ(on_hand − reserved) across eligible locations with **fresh** data.
2. Checkout reserves stock with an atomic conditional update (`reserved = reserved + q WHERE on_hand − reserved ≥ q`) inside the order transaction.
3. Reservations expire (default 30 min unpaid) and are released by a job.
4. Partner-sourced lines are confirmed only after partner acknowledgement (`fulfilment.updated: accepted`) or within agreed rules.

---

## 8. Commerce defaults (Ghana)

- Default currency **GHS** (minor unit: pesewa). Additional currencies are configurable (USD seeded); FX rates are entered manually until a rate source is chosen.
- Taxes are configurable components (compound/non-compound). Seeded Ghana standard set under the VAT Act, 2025 (Act 1151), effective 1 Jan 2026: VAT 15%, NHIL 2.5%, GETFund 2.5%, each on the invoice value (not compounded; COVID levy abolished). Editable in Company settings.
- Store: business customers order online from a customer account (Customer Administrator holds `customer.orders.place`). Visitors and larger carts send the cart as a quotation request. No consumer self-registration yet.
- Invoices: issued automatically with every order (payment terms `invoiceDueDays`, default 14). Printed with company address, GRA TIN and payment instructions from Company settings. Overdue reminders (in-app + e-mail) at most 3, a week apart.
- Payments: **Paystack** (chosen 2026-10-10) — hosted checkout for cards and mobile money in GHS, test keys until go-live. Orders become paid only after SES verifies the transaction with Paystack's API (triggered by the HMAC-SHA512-signed webhook or the return page); amount and currency must match; idempotent; duplicate payments are flagged for refund.

---

## 9. AI assistance (M4, opt-in)

Knowledge-base search, ticket classification and report summaries only. Permission-checked context, per-user/day usage limits, every AI output labelled, and no consequential action (approvals, refunds, price changes) taken without human confirmation. Provider and credentials are a pending decision.

---

## 10. Operations

- **Health**: `GET /api/health` (DB round-trip, job backlog, dead-letter count).
- **Logs**: structured JSON to stdout with request id.
- **CI**: GitHub Actions — install, typecheck, lint, test, `npm audit --audit-level=high`, build.
- **Deployment (recommended)**: one small VPS or PaaS container (2 vCPU / 4 GB) + managed PostgreSQL with point-in-time recovery. Web and worker run as two processes from the same image.
- **Indicative running cost**: about US$40–120/month for a small production setup (app host about $15–40, managed Postgres about $15–50, backups/storage/email about $10–30). Payment and SMS fees are per transaction. Estimates only; confirm with the chosen provider.
- **Backup/restore**: nightly `pg_dump` plus provider PITR; quarterly restore drill; procedure in `docs/operations.md`.
- **Rollback**: immutable image tags; migrations are additive-first (expand/contract), so the previous image runs against the new schema.

---

## 11. Milestones and acceptance criteria

### M1 — Foundation *(complete for local development; see §15 for evidence and gaps)*
- [x] Project scaffold, lint, typecheck, tests, CI, env template, setup script
- [x] Schema + migrations + idempotent demo seed
- [x] Auth: login/logout, sessions, lockout, rate limit, password reset, TOTP MFA (mandatory for privileged)
- [x] Permission engine, role templates, org/department/record scoping, audit log
- [x] Company settings (currency, taxes, approval thresholds)
- [x] Catalogue management (categories, products, variants, prices, stock)
- [x] Public site + store browse (with stale-stock safeguard) + enquiry form → lead
- [x] Sales: leads → quotations (tax calc) → approval (no self-approval) → order with stock reservation
- [x] Integration foundation: connections, API keys, signed webhooks, dedupe, ordering, field ownership, price-change approvals, job queue with retries/dead-letter, health dashboard, SSE live updates
- [x] KingsView simulator + contract tests
- [x] Customer portal (quotes: view/accept; orders) and partner portal (mappings, stock, events) — read-focused

**M1 acceptance**: all tests green; a seeded user per role can sign in and sees only what their permissions allow; simulator events (including duplicates, out-of-order, bad signature, replay) produce the documented results; a quotation over the threshold cannot be approved by its creator; checkout cannot reserve more stock than is available.

### M2 — Operations *(complete, live)*
**M2a — done (2026-10-10):**
- [x] Suppliers; purchase orders (draft → approval at/above `poApprovalThresholdMinor`, default GHS 20,000, never by the creator → sent, e-mailed to supplier → partially received / received; cancel before receipt)
- [x] Goods receipt (GRN numbers) into SES locations, over-receipt refused, stock updated atomically
- [x] Stock movement ledger (`stock_movements`): receipts, adjustments, fulfilment; shown on product pages
- [x] Secure documents on orders, quotes, purchase orders and suppliers: content-type checked by magic bytes, 8 MB cap, no SVG/HTML, random storage names in UPLOAD_DIR (outside the app folder; production default ~/ses-data/uploads), attachment-only downloads with sandbox CSP, customer sharing per file (orders/quotes only), soft delete + audit
- [x] Hourly retention clean-up (sessions, rate limits, reset tokens, finished jobs, sent mail, files of documents deleted > 90 days)
- [x] New permissions: procurement.approve (privileged), procurement.receive, documents.read/write, customer.documents.read

**M2b — done (2026-10-10, live):**
- [x] Warranties (per-variant months; created on fulfilment; listed for staff and customers)
- [x] Returns & warranty claims (RMA): customer request within `returnWindowDays` (default 14) or under warranty → staff approve/reject → receive (optional restock into SES stock, ledger reason "return") → refund approval (`refunds.approve`, never the requester or the receiver) or replacement/repair completion; quantities cannot be claimed twice
- [x] Notifications centre (bell + unread count for staff, customers, partners): approval requests to approvers, decisions to requesters, quotations sent / order confirmed / delivered / cancelled to customer users, new orders to sales, returns, goods received, dead-lettered partner events
- [x] CSV exports (leads, orders, products, stock, purchase orders, returns) — `data.export` + read permission, audited, formula-injection safe; product import with preview, matched by SKU, prices via the approval rules
- [x] Nonce-based Content-Security-Policy per request (`'strict-dynamic'`, no `unsafe-inline` scripts); API/download routes keep locked-down static policies
- [x] Playwright + axe (WCAG 2.1 A/AA) e2e suite in CI on desktop and mobile; deploy bundle is only published when unit tests and e2e pass
- Deferred to when a partner needs it: polling connector + reconciliation (no partner without webhooks yet; avoid guessing an unbuilt API)

### M3 — Portals and commerce
**M3a — built 2026-10-10 (not yet deployed):**
- [x] Store cart (httpOnly cookie, ids + quantities only, tamper-safe) and checkout for customer administrators: re-priced from the database, stock re-checked under row locks, order + reservation + invoice in one transaction; staff/partner accounts and Customer Users cannot order; checkout rate-limited; carts at/above the store limit, out-of-stock or stale-partner items are refused with a reason
- [x] Visitors (and anyone over the limit) can send the cart as a quotation request (lead with the cart lines)
- [x] Invoices issued automatically for store orders and accepted quotations; staff can (re)issue one per order; void only when nothing is paid; cancelling or expiry voids unpaid invoices automatically and tells finance when a refund is due
- [x] Manual payments (bank transfer, mobile money, cash, cheque) by `finance.write` with MFA; amount ≤ balance; duplicate references refused; reversal needs a *different* finance user; all audited
- [x] Paystack now pays the invoice balance (order or invoice page); a payment that arrives after the invoice is settled or void is kept and flagged for refund
- [x] Customer portal: invoices list/detail (printable), outstanding/overdue totals, pay online; order page links its invoice
- [x] Staff: invoices (open/overdue/paid/void), receivables, customer history (orders, invoices, quotations, returns, contacts, leads — per permission, department scope respected), invoice card on orders, invoice/payment CSV exports
- [x] Daily overdue reminders; Company settings for store limit, payment terms, address, TIN, payment instructions
- Not done: credit notes (refunds are recorded on returns; finance refunds in Paystack/bank), GRA e-VAT / fiscal invoice integration (A4), Hubtel/MoMo direct adapters (Paystack already covers mobile money; no second provider chosen)

**M3b — built 2026-10-10 (not yet deployed):**
- [x] Subscriptions: created when an order with monthly/yearly items is fulfilled (or recorded by staff); renewal invoices issued automatically before period end at the current catalogue price; payment (manual or Paystack) extends the period; unpaid renewals lapse after the grace period; customer administrators can stop/restart auto-renewal; staff can cancel
- [x] Service contracts: coverage (business hours Mon–Fri 08:00–17:00 Accra, or 24×7) and response/resolution targets per priority; standard SLA when no active contract
- [x] Support tickets: raised by customers (portal) or staff; SLA due times computed in covered time; first response tracked; internal notes never shown to customers; assignment; priority change re-targets; escalation L1 → L2 → engineering with alerts; pause while waiting on the customer; per-minute breach check with alerts; reopen on reply; daily auto-close; rate-limited for customers
- [x] Projects: customer or internal; milestones, tasks with assignees; sign-off requests only when the milestone's tasks are done; customer administrator signs off or declines with comments (no self sign-off on internal projects — also a DB check); completion only when all milestones are signed off
- [x] Assets: hardware auto-registered on fulfilment (one per unit, up to 100 per line), serials/locations/status/contract edited by staff; warranty and ticket history per asset; customers see their equipment and can report a problem against it
- [x] Customer history shows tickets, subscriptions and projects; portal navigation follows each user's permissions
- New permissions: `subscriptions.manage`, `assets.manage` (operator); `customer.subscriptions.read/manage`, `customer.tickets.read/write`, `customer.projects.read/signoff`, `customer.assets.read`. Engineers gained `support.write` (third-line tickets).
- Not done: Ghana public holidays in the SLA clock; e-mail-to-ticket; time tracking/billing on projects; proration when subscription quantities change mid-period.

### M4 — Insight and advanced *(live 2026-10-11)*
- [x] Department reports (`/ops/reports`, `reports.read`): sales (win rate, order value by month, top items, quotation outcomes), finance (receivables ageing, invoiced vs collected by month, payments by method — test payments excluded), support (opened/resolved, first-response and resolution on-time %, open by priority, by area), recurring revenue (MRR, renewals due, lapsed), projects, operations (awaiting delivery, low stock, purchase spend by supplier, returns); 30/90/365-day periods; each section only with the underlying read permission; printable; accessible list-based charts (no chart library, no scripts)
- [x] Dashboard tiles for open/breached tickets and overdue receivables
- [x] BI exports: CSV for tickets (with SLA outcome), subscriptions, projects and assets, alongside the existing datasets (`data.export` + read permission, audited)
- [x] Knowledge base: public / customers / internal articles, drafts, PostgreSQL full-text search (English stemming, safe query parsing), website help centre `/help`, staff editor, related articles on tickets; three starter portal how-to articles seeded once (editable)
- [x] AI assistance (§9), off by default: needs `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` on the server **and** the Company settings switch. Staff with `ai.use` only. Ticket suggestions (category, priority, draft reply) from customer-visible messages + published non-internal articles, with e-mails/phones/long numbers redacted; report summaries from aggregates only. Output schema-validated, labelled, never applied automatically (draft goes into the reply box for a person to edit and send). Daily per-person limit (default 20). Every call recorded (`ai_requests`, no prompts stored) and audited. Model `AI_MODEL`, default `claude-opus-5-5`.
- [x] Multi-process live updates: PostgreSQL LISTEN/NOTIFY relay (`event-bus-pg.ts`) started in every app process when DATABASE_URL is PostgreSQL — fixes live updates when Passenger runs several workers; reconnects with back-off; PGlite/dev stays in-process
- [x] Hardening: COOP same-origin and X-Permitted-Cross-Domain-Policies headers; `robots.txt` (private areas disallowed), `sitemap.xml` (public pages, live products, public articles), `/.well-known/security.txt`; e2e security suite (every protected page redirects anonymous visitors, APIs refuse them, headers present, customer cannot reach staff or other customers' records); security self-review `docs/security-review.md`
- Not done (external): independent penetration test (F1 in the review); AI provider decision and key; Ghana holiday calendar for SLAs

### M5 — Catalogue, inventory and reporting *(built 2026-10-13; not yet deployed)*
- [x] Grouped side menu with the current page highlighted and its group open (remembered per person); portal menus highlight the current section
- [x] Pictures for products (gallery), categories, brands and service areas: resized and converted to WebP in the browser (EXIF/GPS removed), checked by content and size on the server, stored under `UPLOAD_DIR/media`, served with year-long caching; alt text, ordering, main picture
- [x] Categories with sub-categories, SKU codes and visibility; brands; tags; specification sheets; store filters (category tree, brand, tag, type, sort, SKU/brand search); schema.org Product data and Open Graph images; optional automatic SKUs (`SE-<code>-00001`)
- [x] Inventory: SES-managed locations (sellable or quarantine, default) — partner locations stay feed-only; weighted average cost (goods receipts use the PO unit cost); adjustments with reasons; transfers; blind/cycle stocktakes with scanning (posts counted − system-at-count); serial numbers on receipt, transfer and fulfilment, written onto warranties; barcodes, Code 128 labels, camera/USB scanning; reorder points with hourly alerts; reorder drafts per preferred supplier through PO approval; stock ledger and CSVs
- [x] Reports: sales with comparison and channels, product performance with ABC and margin, inventory health, demand forecast (Holt, 95% safety stock), finance & tax (VAT/NHIL/GETFund by month, payments, aging), procurement (spend, on-time), leads & quotations; accessible SVG charts; audited CSV per report; Monday summary e-mail by permission (switch in Company settings)
- Tests: 127 unit/integration and 170 browser tests passing locally. Migrations `0006_catalogue_media`, `0007_inventory` (PG13-compatible) run on deploy.

---

## 12. Assumptions and open questions

| # | Item | Status |
|---|---|---|
| A1 | **InMotion Power (shared) plan**, domain **synclyticsenterprisesystems.com**. Runs via cPanel Setup Node.js App (Passenger) from a prebuilt standalone bundle (`npm run package:shared`), cPanel PostgreSQL, 5-minute cron to `/api/cron/tick`, polling page refresh. VPS remains the upgrade path for faster sync | Decided |
| A2 | Primary language English; locale `en-GH`; timezone Africa/Accra | Assumed |
| A3 | Logos supplied 2026-10-10 (masters in `logo/`, web assets via `npm run brand:build`); palette navy #002253 / teal #00a6a6 from the logo. Company legal details still needed | Partly resolved |
| A4 | Ghana standard rates (Act 1151) applied. Invoices show company address, TIN and tax breakdown (TIN/address set in Company settings). GRA e-VAT / fiscal-device requirements still to confirm with SES's accountant before invoices are treated as VAT invoices | Rates done; e-VAT open |
| A5 | Paystack chosen; adapter, webhook and portal payment built (test mode). Needs test secret key, then live approval | Waiting for keys |
| A6 | KingsView web app not built yet; to be built later in `E:\Businesses\1.KingsView\KVS-Web-App` against contract v1. Simulator only until then | Later phase |
| A7 | E-mail via InMotion hosting mailbox (SMTP adapter built, queued with retries, bodies erased after send). Switch to a transactional provider if deliverability/volume requires. SMS not decided | Waiting for SMTP credentials |
| A9 | AI provider: code supports Anthropic (Claude) only, switched off. Needs SES's decision, an API key (paid per use) and the settings switch. Privacy notice gains an AI paragraph automatically when switched on | Waiting for decision |
| A10 | Independent penetration test before scaling payments / sensitive data | Recommended, not commissioned |
| A8 | Case studies: realistic *example engagements* (labelled as examples, no named clients) until client-approved stories exist | Done (examples) |

---

## 13. Decisions log

| Date | Decision |
|---|---|
| 2026-10-10 | Next.js 16 modular monolith; PostgreSQL in prod, PGlite for local/tests; Drizzle ORM |
| 2026-10-10 | In-house auth with mandatory TOTP for privileged permissions |
| 2026-10-10 | Postgres-backed job queue instead of Redis; SSE for live updates |
| 2026-10-10 | Departments as data, modules as permission-gated code |
| 2026-10-10 | Money as integer minor units; GHS default |
| 2026-10-10 | PGlite runs with V8 baseline WASM compiler (`src/server/db/wasm-flags.ts`): TurboFan crashed with "out of memory: Zone" on the dev machine (~1 GB free RAM). Dev/test only. |
| 2026-10-10 | Department scope only on roles that work department-tagged records (sales); executives, finance, auditors are organisation-wide so they can approve/review across departments |
| 2026-10-10 | New partner products always arrive as **drafts**; partners never see SES sell prices; partner price rises ≥15% need approval (system-raised, so anyone with `catalogue.price.approve` may decide) |
| 2026-10-10 | Customer Administrator holds a privileged permission (manage own users) → MFA mandatory for customer admins too |
| 2026-10-10 | M3a: every order gets its invoice at creation (one open invoice per order); payments always apply to invoices; online payments never partial (full balance); manual-payment reversal is a two-person action |
| 2026-10-11 | M4: AI is staff-only and suggestion-only; customers get plain knowledge-base search (no AI answers to customers until accuracy is proven); AI sees customer-visible text only, redacted |
| 2026-10-11 | M4: live updates across processes via PostgreSQL LISTEN/NOTIFY instead of adding Redis (no new paid service on shared hosting) |
| 2026-10-10 | M3b: SLA clock uses Accra business hours (UTC, no DST) unless the contract is 24×7; renewals bill in advance at the then-current catalogue price; a lapsed subscription is not revived by late payment (the renewal invoice is voided) |
| 2026-10-10 | Store ordering is for signed-in business customers only (B2B); no public self-registration; cart kept server-side-validated in a cookie rather than browser storage |
| 2026-10-10 | Demo data refused when `NODE_ENV=production`; production seeds reference data only and bootstraps the first admin via `npm run admin:create` |

---

## 14. Progress log

- 2026-10-10 — Inspected the project folder (empty). Created this plan. Started M1.
- 2026-10-11 — **M3 + M4 deployed live.** Verified externally: all public pages 200 (incl. /store/cart, /help), /api/health ok (no queued or dead jobs), private areas redirect to sign-in, security.txt/robots.txt/sitemap.xml served with the https site address, CSP nonce + COOP + X-Frame-Options headers present. Not verifiable from outside: the LISTEN/NOTIFY relay (check the app log for eventbus.listening).
- 2026-10-11 — M4 built: department reports + dashboard tiles, BI exports, knowledge base + help centre, AI assistance (off by default), PostgreSQL LISTEN/NOTIFY relay, hardening (headers, robots/sitemap/security.txt, e2e security suite, security self-review). Migration 0005 (PG13-compatible). 110 unit/integration tests passing (11 new: relay echo/remote/malformed handling, KB audience isolation + stemming + hostile queries, AI off-by-default, redaction, internal notes excluded, schema validation, daily limit, staff-only, report permission sections, receivables ageing, BI exports). Browser-checked locally: help centre, security.txt/robots/sitemap, reports as auditor. CI caught the sitemap being pre-rendered at build time (no database there) — now rendered per request.
- 2026-10-10 — M3b built: subscriptions & renewals, service contracts/SLA, support tickets with escalation and breach alerts, projects with customer sign-off, asset register. Migration 0004 (PG13-compatible). 99 unit/integration tests passing (16 new: business-hours clock, month-end periods, renewal/lapse/stop flows, customer isolation, SLA targets from contract vs standard, internal notes, pause/resume, escalation alerts, breach flagging, reopen/auto-close, asset isolation, sign-off rules). Browser-tested locally: customer raises ticket → staff reply (response met) → project with milestone and task. E2E: ticket flow + a11y on 10 new pages.
- 2026-10-10 — M3a built: store cart/checkout, invoices, manual + Paystack invoice payments, reversals, overdue reminders, customer history, finance exports. Migration 0003 (PG13-compatible). 83 unit/integration tests passing (15 new); new e2e flows (cart → quotation request; customer admin MFA → order → invoice) and a11y checks for the new pages. Browser-tested locally: guest cart, customer checkout, invoice view, finance part-payment, customer history. CI e2e caught one bug (the quotation reference vanished when the emptied cart re-rendered) — fixed by redirecting to a confirmation; CI green, deploy bundle published.
- 2026-10-10 — M2 deployed live; InMotion Backup Manager confirmed (home directory incl. ~/ses-data and PgSQL every 3 days, off-server).
- 2026-10-10 — M2b CI hardening: e2e suite (53 tests, desktop + mobile, WCAG 2.1 A/AA via axe, CSP console check) green. It caught and we fixed: login rate limit tripped by per-test sign-in (now one sign-in per role), secondary-text contrast 4.4:1 on the page background (slate-500 darkened to #556275, ≥5.6:1), colour-only inline links (underlined), invalid aria-label on a span, and /forgot-password being pre-rendered without a CSP nonce (all pages now rendered per request). Deploy bundle publishes only after checks + e2e pass.
- 2026-10-10 — M2b built: returns/warranties, notifications, CSV import/export, nonce CSP (verified in a production build: every script carries the nonce; injected inline handlers are blocked), Playwright + axe in CI. Low-contrast grey text raised to slate-500. 68 unit/integration tests passing.
- 2026-10-10 — M2a built: procurement (suppliers, POs with approval, goods receipt), stock ledger, secure documents, retention clean-up. Found and fixed during the build: a dynamic upload path made the Next.js build trace the whole project (risk of shipping local files) — fixed with trace-ignore hints and a packaging guard that refuses bundles containing .env*/.data/src/tests; global CSP was overriding the download sandbox policy — split header rules. Deploy hook now also resyncs system permission sets. 58 tests passing.
- 2026-10-26 — Security and site polish: Next.js 16.4.0 → 16.4.3 (critical advisories: remote code execution in the image service, server-action denial of service), Zod 4.6.7, Nodemailer 10.2.1; `npm audit --omit=dev` clean. Store paged in SQL (24 per page), category chips/sidebar with counts, removable filter tags, filters that apply on change, loading view and progress bar, page fade, card lift/zoom and scroll-in movement (none for reduced-motion users). New header with current section, shadow on scroll and a phone menu that closes after a choice. Cart link announces its item count.
- 2026-10-18 — Website conversion work (owner: all five former "proposed" services are offered now). Every one of the 12 services has its own page (/services/<slug>: intro, what's included, who it's for, how we work, FAQs, related store items, enquiry form preset to the service, Service/FAQPage/BreadcrumbList structured data, Open Graph picture, sitemap). Enquiries take a contact preference and an optional booked call (day within 60 days + morning/afternoon/evening; phone required), shown on the lead and notified to staff with leads.write. WhatsApp click-to-chat (floating button, footer, contact page, service pages; hidden until the number is set in Company settings). Sticky contact bar on phones. Website AI assistant for visitors (answers only from site content, redacted, per-IP and daily caps, links checked against real pages, handover to the enquiry form; off until AI key + setting). Partners page: KingsView live with link. Placeholder support phone removed from invoices. Case studies link to enquiries. Migration 0009.
- 2026-10-14 — Back to the drawings for slides and store categories at the owner's request (USE_3D = false in scripts/illustrations.mjs; renders kept). Store now shows category pictures (tiles when browsing, picture beside the heading in a category). Deploys keep earlier builds' style files for two weeks so cached pages never lose their styles.
- 2026-10-14 — 3D renders (Blender, scripts/blender/starter_3d.py, shared with KingsView) for home page slides and store categories; service areas keep the drawings. The starter installer upgrades untouched starter pictures (SHA-256 match) and never replaces staff uploads.
- 2026-10-14 — Home page slider (Catalogue → Home page slides) and 23 starter illustrations in navy and teal: 5 slides (available services only), 12 service areas, 6 store categories. Installed with ops/starter-images.mjs <staff e-mail>, which only fills gaps. 128 unit + 4 slide tests, 173 browser tests passing locally.
- 2026-10-14 — Payment details from Synclytics added as editable settings and printed on unpaid invoices: Absa Bank (Synclytics Enterprise, 0141159100, Ring Road Central), MTN MoMo merchant ID 328018, Telecel Cash till 464633. Free-text payment notes kept for extras.
- 2026-10-13 — M5 completed (see §M5): inventory (locations, average cost, transfers, stocktakes, serials on warranties, labels, scanning, reorder) and reports centre with weekly e-mail. Synclytics' GitHub Actions jobs are refused (account spending limit), so no deploy bundle can be built for M5 until billing is fixed.
- 2026-10-13 — M5 (catalogue, inventory, reporting) started. Done: grouped side menu with current page highlighted (portals too); pictures for products, categories, brands and service areas (browser-side resize to WebP, server checks by content, stored in UPLOAD_DIR/media, long-cache serving); categories with sub-categories and SKU codes, brands, tags, specifications; optional automatic SKUs (SE-<code>-00001); store filters (category tree, brand, tag, type, sort, SKU/brand search) and schema.org Product data. 118 unit tests, 127 browser tests passing locally (GitHub Actions blocked by billing again).
- 2026-10-13 — Cron job added (it had never been set up): GET with a browser user agent, because InMotion's firewall returns 406 to curl's default user agent and to body-less POSTs; tick verified 200. KingsView went live on the same account at https://kingsviewsolutions.com.
- 2026-10-10 — **Live** at https://synclyticsenterprisesystems.com (InMotion Power, Node 24.21, cPanel PostgreSQL 13/14). Fixes found during deployment: PG<15 compatibility (no NULLS NOT DISTINCT / gen_random_uuid; guarded by tests/postgres-compat.test.ts), DB connects via 127.0.0.1 after cPanel "Synchronize Grants", app-level http→https redirect (cPanel Force HTTPS unavailable behind nginx), deploy branch now append-only so cPanel can fast-forward. Verified externally: all public pages 200, /api/health ok, http→https 308, valid Let's Encrypt cert. Store empty until real products are added. Pending: first admin login, cron, SMTP test, Paystack test key.
- 2026-10-10 — Source in private GitHub repo washeeb/ses-web-app (main). GitHub Actions "Build deploy bundle" (typecheck, lint, 47 tests, prod audit, Linux build) publishes to the `deploy` branch; cPanel Git Version Control tracks `deploy` and its .cpanel.yml runs deploy-hooks/cpanel-deploy.sh (copy to ~/ses-app keeping .env.production, migrate, restart). First run green. Server-side cPanel setup pending (docs/deploy-inmotion.md §3).
- 2026-10-10 — MFA enrolment shows a server-generated QR code (setup key kept as fallback). DPC registration: settings fields (number, expiry), shown on privacy notice/footer when set, admin dashboard reminder when missing or within 60 days of expiry. Shared hosting support: standalone output, Passenger startup shim, bundled ops scripts (migrate/seed-reference/create-admin), secured cron tick endpoint, polling live-update mode, PGlite loaded lazily (never shipped to production). Local demo DB was found corrupted after an abrupt dev-server stop and was recreated (dev data only).
- 2026-10-10 — Decisions from SES: InMotion hosting + synclyticsenterprisesystems.com, hosting e-mail, Paystack, Ghana standard taxes, example case studies, KingsView app later. Built: SMTP mail adapter (queued, retried, body erased after send), Paystack checkout/webhook/verify with portal Pay button and staff payment panel (test mode), standard tax seed, `customer.orders.pay` permission, docs/deploy-inmotion.md + PM2 file. Tests: 46 passing.
- 2026-10-10 — Brand applied: official logos (header, reverse in footer, stacked on sign-in), favicon/apple/OG images, palette from logo, name spelled "Synclytics".
- 2026-10-10 — M1 implemented: scaffold, schema/migration, seed, auth + MFA, permission engine, settings, catalogue/stock, public site/store, lead→quote→approval→order with reservations, integration framework + KingsView simulator, customer & partner portals, ops UI, SSE live updates, docs, CI, Dockerfile. 40 automated tests passing; production build passing; manual browser walkthrough done.

---

## 15. Status report

### Current (2026-10-10)
- **Live** at https://synclyticsenterprisesystems.com: M1–M4 (M3 + M4 deployed 2026-10-11); before that M1 + M2 (procurement, documents, returns/warranty, notifications, CSV, nonce CSP). Verified externally after deploy: public pages 200, `/api/health` ok, per-request CSP nonce header present. Backups: InMotion Backup Manager (home dir incl. `~/ses-data`, PgSQL; every 3 days, off-server).
- **Built, tested, not yet deployed:** M3a (store checkout, invoices, payments, customer history), M3b (subscriptions, contracts/SLA, tickets, projects, assets) and M4 (reports, BI exports, knowledge base, AI assistance off by default, multi-process live updates, hardening) — see §11.
- **Not verified against real external services:** PostgreSQL LISTEN/NOTIFY relay (logic unit-tested; needs the live PostgreSQL to confirm), Anthropic API (tested with a fake; needs a key), Paystack (needs keys), SMTP (needs credentials).
- **Tested for M3a:** 83 unit/integration tests (cart tampering, pricing with Ghana taxes, checkout permissions/limits/stock, atomic order+invoice, invoice visibility across customers, manual payments with MFA/overpayment/duplicates, two-person reversal, void rules, auto-void on cancel/expiry, Paystack invoice payment incl. duplicate-after-settlement refund flag, reminders cadence, stock hold after payment). Browser (local): guest cart → totals; customer admin MFA enrolment → order → invoice; finance part-payment; customer history; no console/CSP errors. E2E + axe for the new pages run in CI.
- **Still depends on external parties:** Paystack test/live keys (online payment of invoices untested against the real API), SMTP credentials (reminder e-mails queue but are not delivered until set), GRA e-VAT requirements (A4), DPC registration number (later).

### M1 report (historical)

### Works end to end (persisted, validated, permission-checked)
- Sign-in with lockout (5 failures/15 min), per-IP/e-mail rate limits, DB sessions (12 h absolute / 30 min idle), sign-out, password reset (single-use, 30 min), **TOTP MFA enrolment + verification, mandatory for privileged permissions**.
- Permission sets for all 17 requested roles (+ Integration Manager), org/department/record scoping, deny-by-default, self-approval blocked in code **and** by a DB check constraint, own-access changes blocked, privileged grants via second-admin approval.
- Company settings, currencies, configurable taxes (demo GHS rates flagged), approval thresholds; all changes audited.
- Catalogue (products, variants, SES stock locations), manual price changes with approval above 15%, stock counts that cannot drop below reservations.
- Public site (services incl. **Proposed** offerings, partners with KingsView social links, demo-labelled case studies, privacy draft), store with live availability and stale-stock labelling, enquiry form → lead (honeypot + rate limit).
- Lead → customer → quotation (tax calc) → auto-approve or approval → send → customer accepts/declines in portal → order with **atomic stock reservation** (no oversell) → confirm (partner fulfilment request) → fulfil (stock consumed) / cancel (released); reservation expiry job.
- Partner integration: connections (simulator/production), encrypted secrets with rotation, scoped API keys, signed webhooks (HMAC, ±300 s, replay/duplicate protection), versioned ordering, field ownership, price rules, sensitive-price approvals, retries with backoff, dead-letter + manual replay, signed outbound deliveries, health dashboard, partner portal and read API.
- Live UI updates over SSE, filtered by organisation.

### Tested
- `npm test`: 40 tests — passwords, RFC 6238 vectors, lockout, IP rate limit, session idle/revocation, MFA code reuse, reset single-use; role/domain isolation, MFA gating, department scoping, second-admin approval; totals/taxes, threshold approvals, self-approval (service + DB), customer isolation, concurrent last-unit acceptance (one succeeds, other rolls back), cancel releases stock, price approvals; signature/replay/malformed/duplicate/stale/out-of-order handling, draft-only partner products, partner order-line isolation, API key scopes/revocation/MFA, outbound signing, backoff and dead-letter, replay permissions.
- `npm run build`, `tsc`, ESLint clean; `npm audit --omit=dev`: 0 vulnerabilities.
- Manual (browser, local): enquiry, sales quote creation/send, customer MFA enrolment + acceptance → order, integration manager MFA, simulator over real HTTP (202/200 duplicate/401 bad signature/401 replay/stale ignored/out-of-order retried), access denied for sales on audit log, mobile-width layout (no horizontal overflow).

### Not yet tested / known gaps
- No automated accessibility (axe) or end-to-end browser suite yet (planned M2: Playwright + axe). Manual checks only: skip link, labels, focus styles, live regions.
- Not load-tested; sync SLOs in §7.4 are design targets, unmeasured.
- Docker image and PostgreSQL (non-PGlite) path not exercised locally (Docker/Postgres not installed); CI will run on GitHub once the repo is pushed.
- Dev-only dependency advisories: `eslint-config-next` (braces/micromatch) and `drizzle-kit` (old esbuild) — dev tooling only, no runtime exposure; revisit on upstream fixes.
- CSP still allows `unsafe-inline` scripts (Next.js bootstrap); move to nonce-based CSP before production.
- Multi-instance live updates need Postgres LISTEN/NOTIFY (M4); `rate_limits`/`sessions` tables need periodic clean-up jobs (M2).
- Secret rotation is immediate (no dual-secret grace window yet).

### Depends on credentials / external decisions
- SMTP credentials for the InMotion mailbox (adapter ready).
- Paystack test secret key + webhook URL set in the Paystack dashboard (integration ready).
- KingsView web app (later phase, `E:\Businesses\1.KingsView\KVS-Web-App`) — simulator only until then.
- First deployment on the InMotion Power plan (docs/deploy-inmotion.md steps 1–9); company legal details; DPC registration (SES will register later — enter the number in Company settings when issued).

### Next (M2 priorities)
1. Playwright + axe suite for the critical journeys. 2. Real e-mail adapter. 3. Procurement → goods receipt, warehouse moves, returns/warranties. 4. Document uploads (secure). 5. CSV import/export and polling connector + reconciliation. 6. Retention/clean-up jobs and nonce CSP.
