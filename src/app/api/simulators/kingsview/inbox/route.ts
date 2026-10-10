import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { integrationConnections } from "@/server/db/schema";
import { decryptSecret } from "@/server/lib/crypto";
import { SIGNATURE_HEADER, verifySignature } from "@/server/modules/integrations/contracts";
import { recordInbox } from "@/simulators/kingsview/inbox";

export const dynamic = "force-dynamic";

/**
 * SIMULATOR ONLY: stands in for KingsView's (not yet built) endpoint that receives SES events.
 * Disabled unless SIMULATORS_ENABLED=true.
 */
export async function POST(req: Request) {
  if (process.env.SIMULATORS_ENABLED !== "true") return new Response(null, { status: 404 });
  const raw = await req.text();
  const sig = req.headers.get(SIGNATURE_HEADER);
  const conns = await getDb().select().from(integrationConnections).where(eq(integrationConnections.mode, "simulator"));
  const match = conns.find((c) => c.outboundSecretEnc && verifySignature(decryptSecret(c.outboundSecretEnc), raw, sig) === "ok");
  let body: { id?: string; type?: string; data?: unknown } = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  recordInbox({ connectionId: match?.id ?? "unknown", id: String(body.id), type: String(body.type), data: body.data, signatureValid: !!match, receivedAt: new Date().toISOString() });
  return match ? Response.json({ status: "received" }) : Response.json({ error: "invalid_signature" }, { status: 401 });
}
