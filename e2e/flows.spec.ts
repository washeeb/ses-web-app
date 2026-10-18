import { expect, test } from "@playwright/test";
import { expectAccessible, makePng, signIn, signInWithMfa } from "./helpers";
import { STATE } from "./auth.setup";

test("visitor can send an enquiry and gets a reference", async ({ page }) => {
  await page.goto("/contact");
  await page.getByLabel("Your name").fill("E2E Visitor");
  await page.getByLabel("E-mail", { exact: true }).fill("e2e.visitor@example.com");
  await page.getByLabel("How can we help?").fill("Automated test enquiry about network monitoring.");
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await expect(page.getByRole("status")).toContainText(/reference is L-\d{4}-\d{5}/);
});

test("visitor opens a service page and books a call from it", async ({ page }) => {
  await page.goto("/services");
  await page.getByRole("link", { name: "Managed security monitoring" }).click();
  await page.waitForURL(/\/services\/managed-soc$/);
  await expect(page.getByRole("heading", { level: 1, name: "Managed security monitoring" })).toBeVisible();
  await expect(page.getByText("Proposed")).toHaveCount(0);
  await page.getByRole("link", { name: "Enquire or book a call" }).click();
  await expect(page.getByLabel("Area of interest")).toHaveValue("Managed security monitoring");
  await page.getByLabel("Your name").fill("E2E Caller");
  await page.getByLabel("E-mail", { exact: true }).fill("e2e.caller@example.com");
  await page.getByLabel("How can we help?").fill("We would like monitoring for our firewall and servers.");
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Day").fill(tomorrow);
  await page.getByLabel("Time").selectOption("afternoon");
  await page.getByRole("button", { name: "Send enquiry" }).click();
  // A booked call needs a phone number.
  await expect(page.getByRole("alert").filter({ hasText: "phone number" })).toBeVisible();
  await page.getByLabel("Your name").fill("E2E Caller");
  await page.getByLabel("E-mail", { exact: true }).fill("e2e.caller@example.com");
  await page.getByLabel("Phone or WhatsApp").fill("0241234567");
  await page.getByLabel("How can we help?").fill("We would like monitoring for our firewall and servers.");
  await page.getByLabel("Day").fill(tomorrow);
  await page.getByLabel("Time").selectOption("afternoon");
  await page.getByRole("button", { name: "Send enquiry" }).click();
  await expect(page.getByRole("status")).toContainText(new RegExp(`We will call you on ${tomorrow}`));
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
  const menu = nav.getByRole("button", { name: /^Menu/ });
  if (await menu.isVisible()) await menu.click();
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Quotations" })).toBeVisible();
  await nav.getByRole("link", { name: "Quotations" }).click();
  await expect(page).toHaveURL(/\/ops\/quotes$/);
  if (await menu.isVisible()) await menu.click();
  await expect(nav.getByRole("link", { name: "Quotations" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current", "page");
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

test.describe("customer user", () => {
  test.use({ storageState: STATE.customer });
  test("reports a problem and sees the response target", async ({ page }) => {
    await page.goto("/portal/support/new");
    await page.getByLabel("Subject").fill("E2E: scanner not connecting");
    await page.getByLabel("What is happening?").fill("The warehouse scanner will not join the Wi-Fi since this morning.");
    await page.getByLabel("How serious is it?").selectOption("high");
    await page.getByRole("button", { name: "Send to support" }).click();
    await page.waitForURL(/\/portal\/support\/.+raised=1/);
    await expect(page.getByRole("status")).toContainText(/ticket T-\d{4}-\d{5} has been received/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E: scanner not connecting");
    await expectAccessible(page, "ticket page");
  });
});

test.describe("procurement officer", () => {
  test.use({ storageState: STATE.procurement });
  test("creates a product with an automatic SKU and adds a picture", async ({ page }) => {
    await page.goto("/ops/catalogue/new");
    await page.getByLabel("Name", { exact: true }).fill(`E2E firewall ${Date.now()}`);
    await page.getByLabel(/^Price/).fill("1500.00");
    await page.getByRole("button", { name: "Create product" }).click();
    await page.waitForURL(/\/ops\/catalogue\/[0-9a-f-]{36}$/);
    await expect(page.getByText(/SE-GEN-\d{5}/).first()).toBeVisible();
    // The picture is resized and converted in the browser, checked and stored by the server, then served.
    await page.getByLabel("Pictures").setInputFiles({ name: "firewall.png", mimeType: "image/png", buffer: makePng(1000, 1000) });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.getByRole("status").filter({ hasText: "1 image added." })).toBeVisible();
    const img = page.locator('img[src^="/media/"]').first();
    await expect(img).toHaveAttribute("srcset", /320w.*800w.*1000w/);
    const res = await page.request.get((await img.getAttribute("src"))!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/webp");
    await expectAccessible(page, "product page");
  });
  test("adds a home page slide with a picture, sees it in the slider, then deletes it", async ({ page }) => {
    const headline = `E2E slide ${Date.now()}`;
    await page.goto("/ops/catalogue/slides");
    await page.getByLabel("Headline").fill(headline);
    await page.getByLabel("Button label").fill("See the store");
    await page.getByLabel("Button link").fill("//evil.example");
    await page.getByRole("button", { name: "Create slide" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Use a page on this site" })).toBeVisible();
    // The form starts again after a refused save.
    await page.getByLabel("Headline").fill(headline);
    await page.getByLabel("Button label").fill("See the store");
    await page.getByLabel("Button link").fill("/store");
    await page.getByRole("button", { name: "Create slide" }).click();
    await page.waitForURL(/\/ops\/catalogue\/slides\/[0-9a-f-]{36}$/);
    await page.getByLabel("Pictures").setInputFiles({ name: "slide.png", mimeType: "image/png", buffer: makePng(1600, 1067) });
    await page.getByRole("button", { name: "Upload" }).click();
    await expect(page.locator('img[src^="/media/"]').first()).toBeVisible();
    const slideUrl = page.url();

    await page.goto("/");
    const slider = page.getByRole("region", { name: "Highlights" });
    const next = slider.getByRole("button", { name: "Next slide" });
    if (await next.isVisible()) {
      // Other slides exist: stop the rotation, pick ours, then move on from it.
      await slider.getByRole("button", { name: "Stop the slides" }).click();
      await slider.getByRole("button", { name: `: ${headline}` }).click();
      await expect(slider.getByRole("heading", { name: headline })).toBeVisible();
      await next.click();
      await expect(slider.getByRole("heading", { name: headline })).toBeHidden();
    } else {
      await expect(slider.getByRole("heading", { name: headline })).toBeVisible();
    }
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expectAccessible(page, "home page slider");

    await page.goto(slideUrl);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete slide" }).click();
    await page.waitForURL(/\/ops\/catalogue\/slides$/);
    await expect(page.getByRole("link", { name: headline })).toHaveCount(0);
  });
});

test.describe("warehouse officer", () => {
  test.use({ storageState: STATE.warehouse });
  test("receives stock by scanning, then counts it in a stocktake", async ({ page }) => {
    await page.goto("/ops/inventory/receive");
    const receive = page.locator("section", { has: page.getByRole("heading", { name: "Receive a delivery" }) });
    await receive.getByLabel("Item (scan or type)").fill("SES-LAP14-I5-16");
    await receive.getByLabel("Quantity").fill("2");
    await receive.getByLabel("Unit cost (GHS)").fill("9000.00");
    await receive.getByRole("button", { name: "Receive" }).click();
    await expect(receive.getByRole("status")).toContainText("Stock received.");
    await page.goto("/ops/inventory/counts");
    await page.getByRole("button", { name: "Start" }).click();
    const started = await Promise.race([
      page.waitForURL(/\/ops\/inventory\/counts\/[0-9a-f-]{36}$/).then(() => true),
      page.getByRole("alert").filter({ hasText: /still open/ }).waitFor().then(() => false),
    ]);
    if (!started) {
      await page.getByRole("row").filter({ hasText: "open" }).getByRole("link").first().click();
      await page.waitForURL(/\/ops\/inventory\/counts\/[0-9a-f-]{36}$/);
    }
    const scan = page.getByLabel(/Scan each unit/);
    await scan.fill("SES-SRV1U-STD");
    await scan.press("Enter");
    await expect(page.getByRole("status").filter({ hasText: /1 counted/ })).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Finish and post differences" }).click();
    await expect(page.getByText("completed", { exact: true })).toBeVisible();
  });

  test("prints barcode labels", async ({ page }) => {
    await page.goto("/ops/inventory/labels?code_0=SES-LAP14-I5-16&qty_0=3");
    await expect(page.getByRole("img", { name: "Barcode SES-LAP14-I5-16" })).toHaveCount(3);
  });
});

test.describe("auditor reports", () => {
  test.use({ storageState: STATE.auditor });
  test("switches period, highlights the tab and downloads CSV", async ({ page }) => {
    await page.goto("/ops/reports/finance");
    await expect(page.getByRole("navigation", { name: "Reports" }).getByRole("link", { name: "Finance & tax" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("combobox", { name: "Period" }).selectOption("ytd");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page).toHaveURL(/range=ytd/);
    const csv = await page.request.get("/api/reports/tax?range=ytd");
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain("month,net_sales");
  });
});
