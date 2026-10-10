import { rmSync } from "node:fs";
import path from "node:path";
import { DATABASE_URL } from "./env";

// Deletes the LOCAL embedded database only. Refuses to touch PostgreSQL URLs.
if (!DATABASE_URL.startsWith("pglite://") || DATABASE_URL === "pglite://memory") {
  console.error("db:reset only works with a local PGlite DATABASE_URL.");
  process.exit(1);
}
if (!process.argv.includes("--yes")) {
  console.error("This deletes the local demo database. Re-run with: npm run db:reset -- --yes");
  process.exit(1);
}
const dir = path.resolve(DATABASE_URL.slice("pglite://".length));
if (!dir.startsWith(path.resolve(".data"))) {
  console.error(`Refusing to delete ${dir} (outside .data/).`);
  process.exit(1);
}
rmSync(dir, { recursive: true, force: true });
console.log(`Deleted ${dir}. Run npm run db:migrate && npm run db:seed.`);
