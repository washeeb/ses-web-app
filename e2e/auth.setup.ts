import { test as setup } from "@playwright/test";
import { signIn } from "./helpers";

// Sign in once per role and reuse the session, so the suite stays well inside the login rate limits
// (10 attempts per account per 15 minutes) that it would otherwise trip.
export const STATE = { sales: "e2e/.auth/sales.json", customer: "e2e/.auth/customer.json" };

setup("sign in as sales officer", async ({ page }) => {
  await signIn(page, "sales@ses.demo");
  await page.context().storageState({ path: STATE.sales });
});

setup("sign in as customer user", async ({ page }) => {
  await signIn(page, "buyer@customer-a.demo");
  await page.context().storageState({ path: STATE.customer });
});
