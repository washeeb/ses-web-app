import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js injects inline bootstrap scripts; dev needs eval for fast refresh.
      `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      // Paystack hosted checkout is reached by redirect after the "Pay" form submission.
      "form-action 'self' https://checkout.paystack.com",
    ].join("; "),
  },
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
  async headers() {
    return [
      // Site-wide headers for everything except document downloads…
      { source: "/((?!api/documents/).*)", headers: securityHeaders },
      // …which get a locked-down policy: nothing in a downloaded file may run, even if opened in the browser.
      {
        source: "/api/documents/:path*",
        headers: [
          ...securityHeaders.filter((h) => h.key !== "Content-Security-Policy"),
          { key: "Content-Security-Policy", value: "default-src 'none'; sandbox; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
