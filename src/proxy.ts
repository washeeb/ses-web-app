import { NextResponse, type NextRequest } from "next/server";

/**
 * Sends plain-http visitors to https. On InMotion shared hosting, nginx terminates TLS in front of the
 * Node.js app and cPanel's "Force HTTPS Redirect" can be unavailable, so the app does it itself.
 * Only acts when the front-end proxy explicitly reports http, so a missing header can never cause a loop.
 */
export function proxy(request: NextRequest) {
  if (process.env.NODE_ENV !== "production") return NextResponse.next();
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (proto !== "http") return NextResponse.next();
  const appUrl = process.env.APP_URL ?? "";
  if (!appUrl.startsWith("https://")) return NextResponse.next();
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, appUrl);
  return NextResponse.redirect(target, 308);
}

export const config = {
  matcher: "/:path*",
};
