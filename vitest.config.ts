import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    // Each file boots its own in-memory Postgres (PGlite ~350 MB); run files one at a time.
    fileParallelism: false,
    pool: "forks",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      SCRYPT_LOG_N: "10",
      APP_ENCRYPTION_KEY: "dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktMzJieXQ=",
      SIMULATORS_ENABLED: "true",
    },
  },
});
