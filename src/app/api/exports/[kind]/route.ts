import { getDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { exportCsv } from "@/server/modules/csv";
import { getSessionState } from "@/server/web/session";

export const dynamic = "force-dynamic";

/** Permission-checked, audited CSV export (needs data.export plus read access to the data). */
export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const state = await getSessionState();
  if (!state || state.pending || state.actor.organizationType !== "operator") return new Response("Sign in required", { status: 401 });
  const { kind } = await ctx.params;
  try {
    const { filename, csv } = await exportCsv(getDb(), state.actor, kind, new URL(req.url).searchParams);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
