import { eq } from "drizzle-orm";
import { createDb, type DB } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { seed } from "@/server/db/seed";
import { users } from "@/server/db/schema";
import { loadActor } from "@/server/auth/service";
import type { Actor } from "@/server/authz/policy";

export const TEST_PASSWORD = "Correct-Horse-Battery-9";
export const SIM_SECRET = "whsec_test_simulator_secret_value";

export async function setupDb() {
  const { db, close } = createDb("pglite://memory");
  await runMigrations(db, "pglite://memory");
  const seeded = await seed(db, {
    demoPassword: TEST_PASSWORD,
    appUrl: "http://localhost:3000",
    kingsviewSimSecret: SIM_SECRET,
    simulatorsEnabled: true,
    withDemoActivity: false,
  });
  return { db, close, ...seeded };
}

/** Load an actor as if signed in. `mfa` simulates a session that passed MFA. */
export async function actorFor(db: DB, email: string, mfa = true): Promise<Actor> {
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u) throw new Error(`No user ${email}`);
  return (await loadActor(db, u.id, { id: "test-session", mfaVerified: mfa }))!;
}
