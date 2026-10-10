import "./wasm-flags";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Works for both the root database and a transaction. */
export type DB = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;

export function createDb(url: string): { db: DB; close: () => Promise<void> } {
  if (url.startsWith("pglite://")) {
    // Loaded lazily so production builds (PostgreSQL only) never bundle or require the embedded database.
    const req = createRequire(import.meta.url);
    const { PGlite } = req("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
    const { drizzle: drizzlePglite } = req("drizzle-orm/pglite") as typeof import("drizzle-orm/pglite");
    const target = url.slice("pglite://".length);
    if (target !== "memory") mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    const client = target === "memory" ? new PGlite() : new PGlite(target);
    return { db: drizzlePglite({ client, schema }) as unknown as DB, close: () => client.close() };
  }
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.DB_POOL_MAX ?? 5) });
  return { db: drizzlePg({ client: pool, schema }) as unknown as DB, close: () => pool.end() };
}

const globalForDb = globalThis as unknown as { __sesDb?: { db: DB; close: () => Promise<void> } };

/** Process-wide singleton (survives dev hot reloads, which matters for PGlite). */
export function getDb(): DB {
  if (!globalForDb.__sesDb) {
    globalForDb.__sesDb = createDb(process.env.DATABASE_URL ?? "pglite://.data/pglite");
  }
  return globalForDb.__sesDb.db;
}

export { schema };
