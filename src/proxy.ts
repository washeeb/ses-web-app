import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every request:
 * 1. Sends plain-http visitors to https in production. On InMotion shared hosting, nginx terminates TLS in
 *    front of the Node.js app and cPanel's "Force HTTPS Redirect" can be unavailable. Only acts when the
 *    front-end proxy explicitly reports http, so a missing header can never cause a loop.
 * 2. Gives every page a fresh script nonce and a strict Content-Security-Policy: only scripts carrying the
 *    nonce (Next.js adds it to its own) — and scripts they load — may run. Inline event handlers and
 *    injected <script> tags are blocked.
 */
export function proxy(request: NextRequest) {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    const appUrl = process.env.APP_URL ?? "";
    if (proto === "http" && appUrl.startsWith("https://")) {
      return NextResponse.redirect(new URL(request.nextUrl.pathname + request.nextUrl.search, appUrl), 308);
    }
  }

  const path = request.nextUrl.pathname;
  const isPrefetch = request.headers.has("next-router-prefetch") || request.headers.get("purpose") === "prefetch";
  if (path.startsWith("/api/") || path.startsWith("/_next/") || isPrefetch) return NextResponse.next();

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce, isProd);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export function buildCsp(nonce: string, isProd: boolean) {
  return [
    "default-src 'self'",
    // React needs eval only in development (error stack reconstruction).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProd ? "" : " 'unsafe-eval'"}`,
    // Inline style attributes are used by layout code; styles cannot execute script.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Paystack hosted checkout is reached by redirect after the "Pay" form submission.
    "form-action 'self' https://checkout.paystack.com",
    "frame-ancestors 'none'",
    ...(isProd ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export const config = {
  matcher: "/:path*",
};
