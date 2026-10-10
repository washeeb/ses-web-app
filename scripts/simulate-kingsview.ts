// Drives the KingsView SIMULATOR over real HTTP against a running app.
// Usage: npm run sim:kingsview -- <connectionId> [initial|price <sku> <costMinor>|stock <sku> <n>|faults]
import "./env";
import { KingsViewSimulator, SIM_CATALOGUE } from "../src/simulators/kingsview/simulator";

const [connectionId, scenario = "initial", ...args] = process.argv.slice(2);
const secret = process.env.KINGSVIEW_SIM_SECRET;
const base = process.env.APP_URL ?? "http://localhost:3000";
if (!connectionId || !secret) {
  console.error("Usage: npm run sim:kingsview -- <connectionId> [initial|price|stock|faults]  (needs KINGSVIEW_SIM_SECRET)");
  process.exit(1);
}

const sim = new KingsViewSimulator(secret, async (rawBody, signature) => {
  const res = await fetch(`${base}/api/v1/integrations/${connectionId}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "ses-signature": signature },
    body: rawBody,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
});

const results =
  scenario === "price"
    ? [await sim.priceChange(args[0] ?? SIM_CATALOGUE[0].sku, Number(args[1] ?? 600_000))]
    : scenario === "stock"
      ? [await sim.stock(args[0] ?? SIM_CATALOGUE[0].sku, Number(args[1] ?? 3))]
      : scenario === "faults"
        ? [await sim.stock(SIM_CATALOGUE[1].sku, 6), await sim.duplicateLast(), await sim.staleStock(SIM_CATALOGUE[1].sku, 100), await sim.badSignature(), await sim.replayOld(), ...(await sim.outOfOrder())]
        : await sim.initialSync();

for (const r of results) console.log(`${String(r.status).padEnd(4)} ${r.label}  ${JSON.stringify(r.body)}`);
