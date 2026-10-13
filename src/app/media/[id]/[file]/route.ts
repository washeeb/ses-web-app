import { getDb } from "@/server/db/client";
import { CONTENT_TYPES, readImage } from "@/server/modules/media";

export const dynamic = "force-dynamic";

/**
 * Serves stored images: /media/<id>/<width>.<ext>. A file never changes once stored (a new upload gets a new id),
 * so browsers and the host's cache may keep it for a year.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await ctx.params;
  const m = /^(\d{2,4})\.(webp|jpg|png)$/.exec(file);
  if (!m) return new Response("Not found", { status: 404 });
  const found = await readImage(getDb(), id, Number(m[1]), m[2]!);
  if (!found) return new Response("Not found", { status: 404 });
  const etag = `"${found.media.sha256.slice(0, 32)}-${m[1]}"`;
  const headers = {
    "content-type": CONTENT_TYPES[m[2] as keyof typeof CONTENT_TYPES],
    "cache-control": "public, max-age=31536000, immutable",
    etag,
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(found.bytes), { headers: { ...headers, "content-length": String(found.bytes.length) } });
}
