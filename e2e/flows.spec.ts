import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

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

test("sales officer sees only their modules; admin URLs are refused", async ({ page }) => {
  await signIn(page, "sales@ses.demo");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Welcome");
  const nav = page.getByRole("navigation", { name: "Operations" });
  await expect(nav.getByRole("link", { name: "Quotations" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await page.goto("/ops/audit");
  await expect(page.getByText("You can't open this page")).toBeVisible();
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
