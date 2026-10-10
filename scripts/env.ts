// Loads environment for CLI scripts (Next.js does this itself for the app).
// Local: .env.local. Server: variables from cPanel, or an optional .env.production next to the app.
for (const file of [".env.local", ".env.production"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // file absent: rely on the process environment
  }
}
export const DATABASE_URL = process.env.DATABASE_URL ?? "pglite://.data/pglite";
