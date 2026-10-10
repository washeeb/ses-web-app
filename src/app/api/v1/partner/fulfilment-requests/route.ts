import { getDb } from "@/server/db/client";
import { authenticateApiKey, partnerFulfilmentRequests } from "@/server/modules/integrations/manage";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const db = getDb();
  const auth = await authenticateApiKey(db, req.headers.get("authorization"), "orders:read");
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const rows = await partnerFulfilmentRequests(db, auth.organizationId);
  return Response.json({
    data: rows.map((r) => ({
      order_number: r.orderNumber,
      order_status: r.orderStatus,
      line_id: r.lineId,
      sku: r.partnerSku,
      quantity: r.quantity,
      fulfilment_status: r.fulfilmentStatus,
      created_at: r.createdAt,
    })),
  });
}
