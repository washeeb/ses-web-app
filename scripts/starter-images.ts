// Installs the starter illustrations (slides, service pages, shop categories) where no picture exists yet.
// Usage: npm run images:starter -- <staff e-mail>     (the person recorded as uploading them; needs catalogue.write)
// On the server: node ops/starter-images.mjs <staff e-mail>   (reads ./starter-images next to the app)
import { DATABASE_URL } from "./env";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createDb } from "../src/server/db/client";
import { users } from "../src/server/db/schema";
import { loadActor } from "../src/server/auth/service";
import { can } from "../src/server/authz/policy";
import { installStarterImages } from "../src/server/modules/starter-images";

const email = process.argv[2]?.toLowerCase();
if (!email) {
  console.error("Usage: npm run images:starter -- <staff e-mail>");
  process.exit(1);
}
const dir = ["starter-images", "assets/starter-images"].find((d) => existsSync(`${d}/manifest.json`));
if (!dir) {
  console.error("No starter images found. Run `npm run images:build` first.");
  process.exit(1);
}
const { db, close } = createDb(DATABASE_URL);
const [user] = await db.select().from(users).where(eq(users.email, email));
// Shell access to the server stands in for the sign-in and two-step check here.
const actor = user && (await loadActor(db, user.id, { id: "cli", mfaVerified: true }));
if (!actor || !can(actor, "catalogue.write")) {
  console.error(`${email} is not a staff member who can edit the catalogue.`);
  await close();
  process.exit(1);
}
const { added, skipped } = await installStarterImages(db, actor, dir);
await close();
for (const a of added) console.log(`added    ${a}`);
for (const s of skipped) console.log(`skipped  ${s}`);
console.log(`${added.length} picture(s) added.`);
