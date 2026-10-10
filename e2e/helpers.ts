import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { currentStep, totpAt } from "../src/server/auth/totp";

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

/**
 * Signs in an account that must use two-step verification. The first time, it enrols with the setup key
 * shown on the page and keeps the key (in the git-ignored e2e/.auth folder) so a retry can sign in again.
 */
export async function signInWithMfa(page: Page, email: string) {
  const keyFile = path.join("e2e", ".auth", `${email.replace(/[^a-z0-9]/gi, "_")}.totp`);
  await signIn(page, email);
  let secret: string;
  if (page.url().includes("/account/mfa")) {
    secret = (await page.locator("details code").first().textContent({ timeout: 10_000 }))!.replace(/\s/g, "");
    mkdirSync(path.dirname(keyFile), { recursive: true });
    writeFileSync(keyFile, secret);
  } else {
    secret = readFileSync(keyFile, "utf8").trim();
  }
  // A code can only be used once per 30-second step; wait for a fresh step if this one is nearly over.
  if (30 - ((Date.now() / 1000) % 30) < 5) await page.waitForTimeout(6_000);
  await page.getByLabel("Authentication code").fill(totpAt(secret, currentStep()));
  await page.getByRole("button", { name: /Turn on two-step verification|Verify/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/account/mfa") && !u.pathname.startsWith("/login"));
}
