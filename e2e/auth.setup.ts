import { test as setup } from "@playwright/test";
import { signIn } from "./helpers";

// Sign in once per role and reuse the session, so the suite stays well inside the login rate limits
// (10 attempts per account per 15 minutes) that it would otherwise trip.
export const STATE = { sales: "e2e/.auth/sales.json", customer: "e2e/.auth/customer.json", procurement: "e2e/.auth/procurement.json", warehouse: "e2e/.auth/warehouse.json", auditor: "e2e/.auth/auditor.json" };

setup("sign in as sales officer", async ({ page }) => {
  await signIn(page, "sales@ses.demo");
  await page.context().storageState({ path: STATE.sales });
});

setup("sign in as procurement officer", async ({ page }) => {
  await signIn(page, "procurement@ses.demo");
  await page.context().storageState({ path: STATE.procurement });
});

setup("sign in as warehouse officer", async ({ page }) => {
  await signIn(page, "warehouse@ses.demo");
  await page.context().storageState({ path: STATE.warehouse });
});

setup("sign in as auditor", async ({ page }) => {
  await signIn(page, "auditor@ses.demo");
  await page.context().storageState({ path: STATE.auditor });
});

setup("sign in as customer user", async ({ page }) => {
  await signIn(page, "buyer@customer-a.demo");
  await page.context().storageState({ path: STATE.customer });
});
