import { CONTRACT_VERSION } from "@/server/modules/integrations/contracts";

export function GET() {
  return Response.json({ status: "ok", api: "v1", contract: CONTRACT_VERSION });
}
