import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "";

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** Fails on any WCAG 2.1 A/AA violation, listing each rule and the affected elements. */
export async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => `${v.impact} ${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, `${label} accessibility violations`).toEqual([]);
}

/** Collects Content-Security-Policy violations reported in the browser console. */
export function watchCsp(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}
