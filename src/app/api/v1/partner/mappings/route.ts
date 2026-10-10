import { getDb } from "@/server/db/client";
import { authenticateApiKey, partnerMappings } from "@/server/modules/integrations/manage";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const db = getDb();
  const auth = await authenticateApiKey(db, req.headers.get("authorization"), "catalogue:read");
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  const items = await partnerMappings(db, auth.organizationId);
  return Response.json({
    data: items.map((m) => ({
      sku: m.partnerSku,
      ses_sku: m.sesSku,
      listed: m.listed,
      cost: m.partnerCostMinor !== null ? { amount_minor: m.partnerCostMinor, currency: m.partnerCurrency } : null,
      stock: { on_hand: m.onHand, reserved: m.reserved, updated_at: m.lastStockAt, stale: m.stockStale },
      last_synced_at: m.lastSyncedAt,
    })),
  });
}
