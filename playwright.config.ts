import { defineConfig, devices } from "@playwright/test";

// End-to-end and accessibility tests. Run in CI (GitHub Actions) against a production build backed by the
// seeded demo database. Locally: npx playwright install chromium && npm run test:e2e (needs ~1 GB free RAM).
try {
  process.loadEnvFile(".env.local");
} catch {
  // CI creates .env.local via `npm run setup`
}

const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /a11y\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { WORKER_MODE: "inline", MAIL_ADAPTER: "console" },
  },
});
