import { DATABASE_URL } from "./env";
import { createDb } from "../src/server/db/client";
import { startWorker } from "../src/server/worker";

if (DATABASE_URL.startsWith("pglite://")) {
  console.error("PGlite is single-process: with PGlite, use WORKER_MODE=inline (the web process runs jobs).");
  process.exit(1);
}
const { db } = createDb(DATABASE_URL);
startWorker(db, Number(process.env.WORKER_INTERVAL_MS ?? 1000));
