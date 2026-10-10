import { getDb } from "@/server/db/client";
import { receiveWebhook } from "@/server/modules/integrations/inbound";
import { log } from "@/server/lib/log";

export const dynamic = "force-dynamic";

/** Partner → SES signed event intake. See docs/api/partner-integration-v1.md. */
export async function POST(req: Request, ctx: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await ctx.params;
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    return Response.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  const rawBody = await req.text();
  try {
    const result = await receiveWebhook(getDb(), { connectionId, rawBody, headers: req.headers });
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    log.error("webhook.error", { connectionId, error: err instanceof Error ? err.message : String(err) });
    // 5xx tells the partner to retry later.
    return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
  }
}
