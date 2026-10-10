// Bootstraps the first Platform Administrator in a fresh environment.
// Prints a one-time set-password link to the terminal (no e-mail needed). The admin must enrol MFA at first sign-in.
// Usage: npm run admin:create -- admin@yourcompany.com "Full Name"
import { DATABASE_URL } from "./env";
import { and, eq, isNull } from "drizzle-orm";
import { createDb } from "../src/server/db/client";
import { organizations, passwordResetTokens, permissionSets, roleAssignments, users } from "../src/server/db/schema";
import { hashPassword } from "../src/server/auth/password";
import { randomToken, sha256 } from "../src/server/lib/crypto";
import { audit } from "../src/server/modules/audit";

const [email, name] = process.argv.slice(2);
if (!email || !/^[^@\s]+@[^@\s]+$/.test(email) || !name) {
  console.error('Usage: npm run admin:create -- <email> "<name>"');
  process.exit(1);
}
const { db, close } = createDb(DATABASE_URL);
const [ses] = await db.select().from(organizations).where(eq(organizations.type, "operator"));
const [set] = await db.select().from(permissionSets).where(and(eq(permissionSets.key, "platform_admin"), isNull(permissionSets.organizationId)));
if (!ses || !set) {
  console.error("Run `npm run db:seed` (reference data) first.");
  process.exit(1);
}
const normalized = email.toLowerCase();
const [existing] = await db.select().from(users).where(eq(users.email, normalized));
const [user] = existing
  ? [existing]
  : await db.insert(users).values({ email: normalized, name, organizationId: ses.id, passwordHash: await hashPassword(randomToken(24)) }).returning();
await db.insert(roleAssignments).values({ userId: user!.id, permissionSetId: set.id, organizationId: ses.id }).onConflictDoNothing();
const token = randomToken(32);
await db.insert(passwordResetTokens).values({ userId: user!.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) });
await audit(db, { action: "admin.bootstrap", targetType: "user", targetId: user!.id, data: { email: normalized } });
await close();
console.log(`Platform Administrator ready: ${normalized}\nSet a password within 30 minutes:\n${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${token}`);
