import { expect, test } from "@playwright/test";
import { expectAccessible, watchCsp } from "./helpers";
import { STATE } from "./auth.setup";

const PUBLIC = ["/", "/services", "/store", "/store/business-laptop-14", "/store/cart", "/partners", "/case-studies", "/contact", "/help", "/privacy", "/login", "/forgot-password"];

test.describe("public pages", () => {
  for (const path of PUBLIC) {
    test(`${path} is accessible with no CSP errors`, async ({ page }) => {
      const csp = watchCsp(page);
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await expectAccessible(page, path);
      expect(csp).toEqual([]);
    });
  }
});

test.describe("staff pages (sales officer)", () => {
  test.use({ storageState: STATE.sales });
  for (const path of ["/ops", "/ops/leads", "/ops/quotes", "/ops/quotes/new", "/ops/orders", "/ops/catalogue", "/ops/returns", "/ops/notifications", "/ops/departments", "/ops/customers", "/ops/invoices", "/ops/support", "/ops/subscriptions", "/ops/contracts", "/ops/projects", "/ops/assets"]) {
    test(`${path} is accessible`, async ({ page }) => {
      const csp = watchCsp(page);
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expectAccessible(page, path);
      expect(csp).toEqual([]);
    });
  }
});

test.describe("customer pages", () => {
  test.use({ storageState: STATE.customer });
  for (const path of ["/portal", "/portal/invoices", "/portal/support", "/portal/support/new", "/portal/subscriptions", "/portal/projects", "/portal/assets", "/portal/returns", "/portal/notifications"]) {
    test(`${path} is accessible`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expectAccessible(page, path);
    });
  }
});
