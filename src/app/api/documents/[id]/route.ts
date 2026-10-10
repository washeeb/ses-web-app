import { getDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { contentDisposition, readDocument } from "@/server/modules/documents";
import { getSessionState } from "@/server/web/session";

export const dynamic = "force-dynamic";

/** Permission-checked download. Always an attachment, never rendered inline. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const state = await getSessionState();
  if (!state || state.pending) return new Response("Sign in required", { status: 401 });
  const { id } = await ctx.params;
  try {
    const { doc, bytes } = await readDocument(getDb(), state.actor, id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": doc.contentType,
        "content-length": String(bytes.length),
        "content-disposition": contentDisposition(doc.fileName),
        "x-content-type-options": "nosniff",
        "cache-control": "private, no-store",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response("Not found", { status: 404 });
    throw err;
  }
}
