export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if ((process.env.WORKER_MODE ?? "inline") !== "inline") return;
  // Skip during `next build`, which also loads this file.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { getDb } = await import("./server/db/client");
  const { startWorker } = await import("./server/worker");
  startWorker(getDb());
}
