import { expect, test } from "@playwright/test";
import { expectAccessible, signIn, signInWithMfa } from "./helpers";
import { STATE } from "./auth.setup";

test("visitor can send an enquiry and gets a reference", async ({ page }) => {
  await page.goto("/contact");
  await page.getByLabel("Your name").fill("E2E Visitor");
  await page.getByLabel("E-mail").fill("e2e.visitor@example.com");
  await page.getByLabel("How can we help?").fill("Automated test enquiry about network monitoring.");
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await expect(page.getByRole("status")).toContainText(/reference is L-\d{4}-\d{5}/);
});

test("keyboard users can reach the main content and navigation", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test.describe("sales officer", () => {
  test.use({ storageState: STATE.sales });
  test("sees only their modules; admin URLs are refused", async ({ page }) => {
  await page.goto("/ops");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome");
  const nav = page.getByRole("navigation", { name: "Operations" });
  await expect(nav.getByRole("link", { name: "Quotations" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await page.goto("/ops/audit");
  await expect(page.getByText("You can't open this page")).toBeVisible();
  });
});

test("customer sees the seeded quotation and cannot reach operations", async ({ page }) => {
  await signIn(page, "buyer@customer-a.demo");
  await expect(page).toHaveURL(/\/portal/);
  await expect(page.getByRole("link", { name: /Q-\d{4}-\d{5}/ }).first()).toBeVisible();
  await page.goto("/ops");
  await expect(page).toHaveURL(/\/portal/);
});

test("privileged users must set up two-step verification with a QR code", async ({ page }) => {
  await signIn(page, "exec@ses.demo");
  await expect(page).toHaveURL(/\/account\/mfa/);
  await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
});

test("visitor fills a cart and sends it as a quotation request", async ({ page }) => {
  await page.goto("/store/business-laptop-14");
  await page.getByLabel(/^Quantity of Core i5/).fill("3");
  await page.getByRole("button", { name: /Add to cart.*Core i5/ }).click();
  await expect(page.getByRole("status")).toContainText("Added to your cart");
  await expect(page.getByRole("link", { name: "Cart (3)" }).first()).toBeVisible();
  await page.goto("/store/cart");
  await expect(page.getByText("GHS 45,000.00")).toBeVisible(); // 3 × 12,500 + 20% taxes
  await page.getByLabel("Your name").fill("E2E Cart Visitor");
  await page.getByLabel("E-mail").fill("e2e.cart@example.com");
  await page.getByRole("button", { name: "Request quotation" }).click();
  await expect(page.getByRole("status")).toContainText(/reference is L-\d{4}-\d{5}/);
  await expect(page.getByRole("link", { name: "Cart", exact: true }).first()).toBeVisible();
});

test("customer administrator orders from the store and receives an invoice", async ({ page }) => {
  await signInWithMfa(page, "buyer.admin@customer-a.demo");
  await page.goto("/store/business-laptop-14");
  await page.getByRole("button", { name: /Add to cart.*Core i5/ }).click();
  await expect(page.getByRole("status")).toContainText("Added to your cart");
  await page.goto("/store/cart");
  await page.getByLabel("Your purchase order or reference (optional)").fill("E2E-PO-1");
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForURL(/\/portal\/orders\/.+placed=1/);
  await expect(page.getByText(/invoice INV-\d{4}-\d{5} has been issued/)).toBeVisible();
  await page.getByRole("link", { name: /^INV-/ }).click();
  await expect(page.getByRole("heading", { name: /^Invoice INV-/ }).first()).toBeVisible();
  await expect(page.getByText("Your ref. E2E-PO-1")).toBeVisible();
  await expectAccessible(page, "invoice page");
});
