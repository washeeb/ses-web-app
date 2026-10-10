// Production bundles talk to PostgreSQL only; the embedded dev database is not shipped.
export class PGlite {
  constructor() {
    throw new Error("PGlite is not available in the production bundle. Set DATABASE_URL to a PostgreSQL URL.");
  }
}

// drizzle-orm/pglite reads type ids from here; never used with PostgreSQL.
export const types = {};
