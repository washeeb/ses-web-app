import v8 from "node:v8";

// PGlite (dev/test database) is a large WebAssembly module. On some machines V8's optimising
// compiler runs out of memory on it ("Fatal process out of memory: Zone"). The baseline
// compiler is fast enough here. Must run before the first PGlite instance is created.
// Production uses PostgreSQL via `pg` and never loads PGlite.
if ((process.env.DATABASE_URL ?? "pglite://").startsWith("pglite://")) {
  v8.setFlagsFromString("--liftoff-only");
  v8.setFlagsFromString("--no-wasm-tier-up");
}
