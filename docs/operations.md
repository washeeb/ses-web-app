# Operations runbook

> Status: written for the M1 codebase. Deployment, backup and restore steps have **not** been rehearsed against real infrastructure yet.

## Architecture in production

- **web**: `npm run build && npm start` (Next.js, Node ≥ 22), behind HTTPS (reverse proxy or PaaS router). Set `TRUST_PROXY=true` only behind a trusted proxy.
- **worker**: `npm run worker`. Processes the job queue (partner events, outbound deliveries, reservation expiry). Set `WORKER_MODE=external` on the web process.
- **PostgreSQL 15+** (managed, with point-in-time recovery). `DATABASE_URL=postgres://…`.
- Live UI updates use an in-process bus. **With more than one web instance or an external worker, live pushes from the worker do not reach browsers yet.** Pages stay correct on reload. A Postgres `LISTEN/NOTIFY` transport is planned for M4. Until then, run one web instance with `WORKER_MODE=inline`, or accept reload-based freshness.

## Required environment

| Variable | Notes |
|---|---|
| `DATABASE_URL` | PostgreSQL URL in production |
| `APP_URL` | Public HTTPS origin |
| `APP_ENCRYPTION_KEY` | 32 random bytes, base64. **Back it up separately from the database.** Losing it makes integration secrets and MFA seeds unreadable. |
| `WORKER_MODE` | `external` (web) when the worker runs separately |
| `SIMULATORS_ENABLED` | **`false` in production** |
| `MAIL_ADAPTER` | Only `console` exists today. A real provider is required before go-live (password resets, invitations). |

Keep secrets in the host's secret manager, never in the repository or images.

## Deploy

1. CI must be green (typecheck, lint, tests, audit, build).
2. Back up the database (or confirm PITR is active).
3. `npm ci && npm run build`
4. `npm run db:migrate` (one instance only). Migrations are additive-first (expand → deploy → contract) so the previous release keeps working.
5. Start or restart the worker, then web. Check `GET /api/health` returns `{"status":"ok"}`.
6. Smoke test: sign in, open `/ops`, `/store`, and an integration page.

## Roll back

- Redeploy the previous build/image. Because migrations are expand-first, the old code runs against the new schema.
- Do not run down-migrations in production. Fix forward with a new migration if a schema change was wrong.

## Backup and restore

- **Daily** logical backup: `pg_dump --format=custom --no-owner "$DATABASE_URL" > ses-$(date +%F).dump`, encrypted and stored off-site for 35 days, plus the provider's PITR.
- **Restore drill (quarterly)**:
  1. Create an empty database.
  2. `pg_restore --no-owner --dbname "$RESTORE_URL" ses-YYYY-MM-DD.dump`.
  3. Point a staging app at it with the **same** `APP_ENCRYPTION_KEY` and verify sign-in, quotes and integration pages.
  4. Record the time taken (RTO) and the backup age (RPO).
- Local PGlite data lives in `.data/` and is disposable (`npm run db:reset -- --yes`).

## Monitoring

- `GET /api/health`: DB latency, queued, running and dead jobs. Alert if `status` ≠ ok, if `dead` > 0, or if `queued` keeps growing.
- Structured JSON logs on stdout (`level`, `msg`, context). Ship them to the host's log service. Alert on `webhook.signature_rejected` spikes and `worker.tick_failed`.
- Integration health page (`/ops/integrations`): last event, last sync, failing and dead events, stale stock rows.

## Incident handling (outline)

1. **Triage**: what is affected (site, sign-in, integrations, data) and since when.
2. **Contain**: for a suspected credential leak, rotate the affected integration secrets or API keys from `/ops/integrations/{id}`, disable affected users, and pause the connection.
3. **Investigate**: use the audit log (`/ops/audit`) and application logs.
4. **Recover**: restore from backup if needed, then replay dead-lettered events.
5. **Notify**: where personal data is involved, assess obligations under the Data Protection Act, 2012 (Act 843) with SES's legal adviser.
6. **Review**: write up the root cause and actions.

## Indicative running costs (estimate)

| Item | Monthly (USD) |
|---|---|
| App host (2 vCPU / 4 GB container or VPS) | 15–40 |
| Managed PostgreSQL with PITR | 15–50 |
| Backups, storage, e-mail provider | 10–30 |
| **Total** | **~40–120** |

Payment and SMS fees are per transaction and come on top. Confirm with the chosen providers.
