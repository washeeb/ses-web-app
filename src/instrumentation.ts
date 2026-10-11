export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Skip during `next build`, which also loads this file.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const url = process.env.DATABASE_URL ?? "";
  // With PostgreSQL, live updates are relayed between all app processes (Passenger may run several).
  if (/^postgres(ql)?:\/\//.test(url)) {
    const { startPgEventBus } = await import("./server/modules/event-bus-pg");
    startPgEventBus(url);
  }
  if ((process.env.WORKER_MODE ?? "inline") !== "inline") return;
  const { getDb } = await import("./server/db/client");
  const { startWorker } = await import("./server/worker");
  startWorker(getDb());
}
