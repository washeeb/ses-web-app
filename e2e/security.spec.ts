import { expect, test } from "@playwright/test";
import { STATE } from "./auth.setup";

// Every protected area must send anonymous visitors to sign in, and APIs must refuse them.
const PROTECTED = [
  "/ops", "/ops/leads", "/ops/quotes", "/ops/orders", "/ops/invoices", "/ops/customers", "/ops/support", "/ops/subscriptions",
  "/ops/contracts", "/ops/projects", "/ops/assets", "/ops/reports", "/ops/knowledge", "/ops/audit", "/ops/admin/users", "/ops/admin/settings",
  "/portal", "/portal/invoices", "/portal/support", "/portal/subscriptions", "/portal/projects", "/portal/assets", "/partner",
];

test.describe("anonymous visitors", () => {
  for (const path of PROTECTED) {
    test(`${path} requires sign-in`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test("APIs refuse anonymous access", async ({ request }) => {
    expect((await request.get("/api/exports/orders")).status()).toBeGreaterThanOrEqual(400);
    expect([401, 403, 404]).toContain((await request.get("/api/documents/00000000-0000-0000-0000-000000000000")).status());
    expect([401, 403]).toContain((await request.get("/api/v1/partner/mappings")).status());
  });

  test("security headers and policies are served", async ({ request }) => {
    const res = await request.get("/");
    const h = res.headers();
    expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin");
    expect(h["x-powered-by"]).toBeUndefined();
    const sec = await request.get("/.well-known/security.txt");
    expect(sec.status()).toBe(200);
    expect(await sec.text()).toMatch(/^Contact: mailto:/m);
    expect(await (await request.get("/robots.txt")).text()).toMatch(/Disallow: \/ops/);
  });
});

test.describe("signed-in customer", () => {
  test.use({ storageState: STATE.customer });
  test("cannot reach staff areas or another customer's records", async ({ page }) => {
    await page.goto("/ops/invoices");
    await expect(page).toHaveURL(/\/portal/);
    const res = await page.goto("/portal/invoices/00000000-0000-0000-0000-000000000000");
    expect(res?.status()).toBe(404);
  });
});
