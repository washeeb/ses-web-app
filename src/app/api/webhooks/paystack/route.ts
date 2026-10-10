import { getDb } from "@/server/db/client";
import { receivePaystackWebhook } from "@/server/modules/payments/paystack";

export const dynamic = "force-dynamic";

/** Paystack → SES. Signature-checked, then verified against Paystack's API by the job queue. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > 100_000) return new Response(null, { status: 413 });
  const r = await receivePaystackWebhook(getDb(), raw, req.headers.get("x-paystack-signature"));
  return new Response(null, { status: r.status });
}
