import { getDb } from "@/server/db/client";
import { getSettings } from "@/server/modules/settings";

export const dynamic = "force-dynamic";

/** RFC 9116: how to report a security problem. */
export async function GET() {
  const s = await getSettings(getDb());
  const base = process.env.APP_URL ?? "https://synclyticsenterprisesystems.com";
  const expires = new Date(Date.now() + 180 * 86_400_000).toISOString();
  const body = [`Contact: mailto:${s.supportEmail}`, `Expires: ${expires}`, "Preferred-Languages: en", `Canonical: ${base}/.well-known/security.txt`, `Policy: ${base}/privacy`, ""].join("\n");
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" } });
}
