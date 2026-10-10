import { DATABASE_URL } from "./env";
import { createDb } from "../src/server/db/client";
import { seed, seedReference } from "../src/server/db/seed";

const { db, close } = createDb(DATABASE_URL);
if (process.env.NODE_ENV === "production" || process.argv.includes("--reference-only")) {
  await seedReference(db);
  await close();
  console.log("Reference data seeded (no demo data). Create the first administrator with: npm run admin:create -- <email> \"<name>\"");
} else {
  const demoPassword = process.env.SEED_DEMO_PASSWORD;
  if (!demoPassword || demoPassword.length < 12) {
    console.error("SEED_DEMO_PASSWORD must be set (12+ characters). Run `npm run setup`.");
    process.exit(1);
  }
  await seed(db, {
    demoPassword,
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
    kingsviewSimSecret: process.env.KINGSVIEW_SIM_SECRET,
    simulatorsEnabled: process.env.SIMULATORS_ENABLED === "true",
    withDemoActivity: true,
  });
  await close();
  console.log("Seed complete. Demo accounts are listed in docs/demo-accounts.md (password: SEED_DEMO_PASSWORD in .env.local).");
}
