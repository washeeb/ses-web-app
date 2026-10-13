import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
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

/** A real PNG (solid colour gradient) for upload tests, built without image libraries. */
export function makePng(width: number, height: number) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) {
      raw[row + 1 + x * 3] = 176;
      raw[row + 2 + x * 3] = Math.round((x / width) * 255);
      raw[row + 3 + x * 3] = Math.round((y / height) * 255);
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
