import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const req = (url: string, proto?: string) => new NextRequest(url, { headers: proto ? { "x-forwarded-proto": proto } : {} });

describe("http → https redirect", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("redirects production http requests to the https APP_URL, keeping path and query", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://synclyticsenterprisesystems.com");
    const res = proxy(req("http://synclyticsenterprisesystems.com/store?q=router", "http"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("https://synclyticsenterprisesystems.com/store?q=router");
  });

  it("never redirects https, unknown scheme, or development", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://synclyticsenterprisesystems.com");
    expect(proxy(req("https://synclyticsenterprisesystems.com/", "https")).headers.get("location")).toBeNull();
    expect(proxy(req("http://synclyticsenterprisesystems.com/")).headers.get("location")).toBeNull();
    vi.stubEnv("NODE_ENV", "development");
    expect(proxy(req("http://localhost:3000/", "http")).headers.get("location")).toBeNull();
  });
});

describe("content security policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("gives each page a fresh nonce and no unsafe-inline scripts", () => {
    vi.stubEnv("NODE_ENV", "production");
    const a = proxy(req("https://synclyticsenterprisesystems.com/store", "https")).headers.get("content-security-policy")!;
    const b = proxy(req("https://synclyticsenterprisesystems.com/store", "https")).headers.get("content-security-policy")!;
    const nonce = (s: string) => /'nonce-([^']+)'/.exec(s)?.[1];
    expect(nonce(a)).toBeTruthy();
    expect(nonce(a)).not.toBe(nonce(b));
    const scriptSrc = a.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("unsafe-eval");
    expect(a).toContain("frame-ancestors 'none'");
    expect(a).toContain("object-src 'none'");
  });

  it("leaves API routes and static assets to their own headers", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(proxy(req("https://synclyticsenterprisesystems.com/api/health", "https")).headers.get("content-security-policy")).toBeNull();
    expect(proxy(req("https://synclyticsenterprisesystems.com/_next/static/x.js", "https")).headers.get("content-security-policy")).toBeNull();
  });
});
