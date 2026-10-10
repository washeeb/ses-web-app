# Synclytics Enterprise Systems — Web Platform

Public website, store, customer portal, partner portal, operations platform and partner integration framework in one Next.js application.
The specification, decisions and progress live in [PROJECT_MASTER_PLAN.md](PROJECT_MASTER_PLAN.md).

## Quick start (local)

Requires Node.js 22+ (developed on Node 24). No database install is needed: local development uses PGlite, an embedded PostgreSQL.

```bash
npm install
npm run setup      # creates .env.local with fresh secrets, migrates, seeds demo data
npm run dev        # http://localhost:3000
```

Demo sign-ins: [docs/demo-accounts.md](docs/demo-accounts.md).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `build` | Next.js (production output is a standalone server: `npm start` runs `.next/standalone/server.js`) |
| `npm run package:shared` | Upload-ready zip for InMotion shared hosting — see [docs/deploy-inmotion.md](docs/deploy-inmotion.md) |
| `npm test` | Vitest suites (auth, permissions, sales, integration contract) |
| `npm run check` | typecheck + lint + tests |
| `npm run db:generate` | Generate a migration after editing `src/server/db/schema.ts` |
| `npm run db:migrate` / `db:seed` | Apply migrations / seed (idempotent) |
| `npm run db:reset -- --yes` | Delete the local PGlite database |
| `npm run worker` | Background worker (PostgreSQL only; with PGlite the web process runs jobs) |
| `npm run sim:kingsview -- <connectionId> [initial\|price\|stock\|faults]` | Drive the KingsView **simulator** over HTTP against a running app |

## Layout

```
src/app/            routes: (site) store portal partner ops api/v1 (auth)
src/server/         db, auth, authz (permissions & policy), modules (business logic), web helpers
src/simulators/     KingsView simulator (test only)
tests/              Vitest suites on in-memory PGlite
docs/               API contract, operations runbook, privacy draft
```

## Notes

- **PGlite and memory**: on machines with limited RAM, V8's optimising WebAssembly compiler can crash on PGlite ("Fatal process out of memory: Zone"). `src/server/db/wasm-flags.ts` switches V8 to its baseline compiler for PGlite only. Production uses PostgreSQL and is unaffected.
- Stop the dev server with Ctrl+C rather than killing the process: PGlite can corrupt its files if stopped mid-write. If pages fail with `RuntimeError: Aborted()`, recreate the demo database: `npm run db:reset -- --yes && npm run db:migrate && npm run db:seed`.
- Tests run one file at a time, because each file starts its own in-memory database (about 350 MB).
- Operations: [docs/operations.md](docs/operations.md) · Partner contract: [docs/api/partner-integration-v1.md](docs/api/partner-integration-v1.md)
