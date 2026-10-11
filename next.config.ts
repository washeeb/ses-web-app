import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

/** Headers for every response. Pages get their Content-Security-Policy (with a per-request nonce) from src/proxy.ts. */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  // Self-contained server bundle (.next/standalone/server.js): suits cPanel "Setup Node.js App" and VPS alike.
  output: "standalone",
  // Logos are pre-optimised by scripts/brand-assets.mjs; skipping runtime optimisation avoids a native
  // image library on the host (the bundle is built on Windows and runs on Linux).
  images: { unoptimized: true },
  poweredByHeader: false,
  // Document uploads are capped at 8 MB in code; leave room for multipart overhead.
  experimental: { serverActions: { bodySizeLimit: "9mb" } },
  async rewrites() {
    return [{ source: "/.well-known/security.txt", destination: "/api/security-txt" }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // JSON/CSV/SSE endpoints never need to load or run anything.
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }] },
      // Downloaded documents: nothing in them may run, even if opened in the browser.
      { source: "/api/documents/:path*", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox; frame-ancestors 'none'" }] },
    ];
  },
};

export default nextConfig;
