import { eq } from "drizzle-orm";
import type { DB } from "../../db/client";
import { integrationConnections } from "../../db/schema";
import { decryptSecret } from "../../lib/crypto";
import type { JobRow } from "../jobs";
import { SIGNATURE_HEADER, signPayload } from "./contracts";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number }>;

/** Job handler: signed delivery of an SES event to a partner system. Throwing triggers retry/backoff. */
export async function deliverOutbound(db: DB, payload: Record<string, unknown>, job: JobRow, fetchImpl: FetchLike = fetch) {
  const connectionId = String(payload.connectionId);
  const [conn] = await db.select().from(integrationConnections).where(eq(integrationConnections.id, connectionId));
  if (!conn) throw new Error("Connection no longer exists");
  if (conn.status !== "active") throw new Error(`Connection is ${conn.status}; delivery postponed`);
  if (!conn.outboundUrl || !conn.outboundSecretEnc) throw new Error("No outbound endpoint configured for this connection");
  const body = JSON.stringify({
    id: `ses_${job.id}`,
    type: payload.type,
    occurred_at: job.createdAt.toISOString(),
    version: job.createdAt.getTime(),
    data: payload.data,
  });
  const res = await fetchImpl(conn.outboundUrl, {
    method: "POST",
    headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signPayload(decryptSecret(conn.outboundSecretEnc), body) },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Partner endpoint responded ${res.status}`);
}

export function validateOutboundUrl(url: string, mode: "simulator" | "production") {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "Enter a valid URL.";
  }
  if (mode === "production" && u.protocol !== "https:") return "Production endpoints must use HTTPS.";
  if (!["http:", "https:"].includes(u.protocol)) return "Only HTTP(S) endpoints are supported.";
  return null;
}
