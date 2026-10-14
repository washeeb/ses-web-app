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

test.describe("catalogue pages (procurement officer)", () => {
  test.use({ storageState: STATE.procurement });
  for (const path of ["/ops/catalogue/new", "/ops/catalogue/categories", "/ops/catalogue/brands", "/ops/catalogue/tags", "/ops/catalogue/services", "/ops/catalogue/services/infrastructure", "/ops/catalogue/slides"]) {
    test(`${path} is accessible`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expectAccessible(page, path);
    });
  }
});

test.describe("inventory pages (warehouse officer)", () => {
  test.use({ storageState: STATE.warehouse });
  for (const path of ["/ops/inventory", "/ops/inventory/receive", "/ops/inventory/transfers", "/ops/inventory/counts", "/ops/inventory/reorder", "/ops/inventory/serials?q=FW", "/ops/inventory/labels?code_0=SES-LAP14-I5-16&qty_0=2", "/ops/inventory/movements", "/ops/inventory/locations"]) {
    test(`${path} is accessible`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expectAccessible(page, path);
    });
  }
});

test.describe("reports (auditor)", () => {
  test.use({ storageState: STATE.auditor });
  for (const path of ["/ops/reports", "/ops/reports/sales", "/ops/reports/sales?range=12m", "/ops/reports/products", "/ops/reports/inventory", "/ops/reports/forecast", "/ops/reports/finance", "/ops/reports/purchasing", "/ops/reports/pipeline"]) {
    test(`${path} is accessible`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main h1")).toBeVisible();
      await expectAccessible(page, path);
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
