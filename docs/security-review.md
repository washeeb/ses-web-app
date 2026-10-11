# Security self-review (M4)

**Date:** 2026-10-11 · **Scope:** the SES web platform (public site, store, customer and partner portals, operations, APIs) as built through M4.
**Status:** internal review by the development team with automated checks. **This is not an independent penetration test.** Commission one from a qualified third party before taking live card payments at volume or handling sensitive customer data at scale (see "Recommended next steps").

## How the platform defends itself

| Area | Control | Evidence |
|---|---|---|
| Authentication | scrypt password hashes; DB sessions (12 h absolute / 30 min idle); lockout after 5 failures; per-IP and per-account rate limits; single-use reset links (30 min) | `tests/auth.test.ts` |
| Two-step verification | TOTP (QR enrolment), mandatory for anyone holding a privileged permission (finance, approvals, admin, customer administrators); code reuse blocked | `tests/auth.test.ts`, e2e MFA flows |
| Authorisation | deny-by-default permission engine; organisation, department and record scope; customers/partners never cross organisation boundaries; existence of other customers' records is hidden (404) | `tests/authz.test.ts`, isolation tests in every module suite, `e2e/security.spec.ts` |
| Separation of duties | no self-approval (code + DB check constraint); second person for payment reversal, refund approval, internal milestone sign-off (also a DB check) | `tests/sales.test.ts`, `tests/invoices-store.test.ts`, `tests/services.test.ts` |
| Browser hardening | per-request nonce CSP with `strict-dynamic` (no inline scripts); `frame-ancestors 'none'`/X-Frame-Options DENY; nosniff; strict referrer; COOP same-origin; HSTS in production; no `X-Powered-By` | `tests/https-redirect.test.ts`, `e2e/security.spec.ts`, e2e CSP console check on every page |
| CSRF | Next.js server actions check the request origin; cookies are `SameSite=Lax`, `HttpOnly`, `Secure` in production | framework behaviour |
| Input handling | Zod validation on every mutation; parameterised SQL only (Drizzle); full-text search uses `websearch_to_tsquery` (no user-controlled syntax errors); CSV exports neutralise spreadsheet formulas | module tests, `tests/aftersales-csv.test.ts` |
| Files | magic-byte type detection, 8 MB cap, no SVG/HTML, random storage names outside the app folder, attachment-only downloads with a sandbox CSP | `tests/procurement-documents.test.ts` |
| Payments | Paystack truth comes only from the verify API (webhook HMAC-SHA512 checked); amount/currency must match; duplicates flagged for refund; no card data touches SES | `tests/payments-mail.test.ts`, `tests/invoices-store.test.ts` |
| Partner API | hashed, scoped, expiring API keys; HMAC-signed webhooks with timestamp window, replay and duplicate protection | `tests/integrations.test.ts` |
| AI assistance | off by default; staff-only (`ai.use`); internal notes and contact details never sent; prompts treat customer text as data; output schema-validated; never acts automatically; daily per-person limit; every call audited | `tests/insight.test.ts` |
| Audit & privacy | append-only audit log of sensitive actions; retention clean-up job; privacy notice reflects AI use when switched on; `security.txt` for vulnerability reports | `tests/procurement-documents.test.ts` (retention), `e2e/security.spec.ts` |
| Supply chain | `npm audit --omit=dev --audit-level=high` in CI; lockfile installs (`npm ci`); deploy bundle refuses to package `.env*`, local data or sources | CI workflow, `scripts/package-shared.mjs` |

## Findings and residual risks

| # | Finding | Risk | Status / recommendation |
|---|---|---|---|
| F1 | No independent penetration test has been performed. | Medium | **Open.** Commission an external test (web app + API, authenticated as each role). |
| F2 | Styles allow `'unsafe-inline'` (needed for small inline width styles, e.g. report bars). Scripts do not. | Low | Accepted: CSS injection is far less dangerous than script injection, and all user content is escaped by React. |
| F3 | The SLA clock does not know Ghana public holidays. | Low (operational) | Open — add a holiday calendar in Company settings. |
| F4 | Secret rotation for partner webhooks is immediate (no overlap window). | Low | Open — add dual-secret grace period when a production partner goes live. |
| F5 | Shared hosting: the app, database and mail share one account; a compromise of the cPanel login exposes everything. | Medium | Use a strong unique cPanel password with 2FA enabled in cPanel; restrict who has it. Consider a VPS with managed PostgreSQL as volume grows. |
| F6 | GitHub secret scanning / push protection depends on repository settings. | Low | Turn on *Secret scanning* and *Push protection* in the GitHub repository settings (free for private repos on most plans; check yours). |
| F7 | Login rate limits are per instance-wide database counters; a distributed attack from many IPs is slowed but not stopped. | Low | Acceptable for current scale; InMotion ModSecurity also filters obvious attacks. |

## Recommended next steps before scaling
1. External penetration test (F1).
2. Enable cPanel two-factor authentication and GitHub secret scanning (F5, F6).
3. Quarterly restore drill from InMotion Backup Manager (database + `~/ses-data`).
4. Review permission assignments quarterly (Users & access → export the audit log).
