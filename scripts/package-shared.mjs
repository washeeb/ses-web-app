// Builds an upload-ready bundle for InMotion shared hosting (cPanel "Setup Node.js App" / Passenger).
// Usage: npm run package:shared             → deploy/ses-shared-<date>.zip (manual upload)
//        node scripts/package-shared.mjs --no-zip   → .next/standalone only (CI publishes it to the `deploy` branch)
// Everything needed at runtime is inside; no `npm install` or `next build` on the server.
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const out = path.join(root, ".next", "standalone");
const run = (cmd, env = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });

// 1. Production build with polling live updates (long-lived connections are unsuitable on shared hosting).
rmSync(path.join(root, ".next", "standalone"), { recursive: true, force: true });
run("npx next build", { NEXT_PUBLIC_LIVE_UPDATES: "poll", NODE_ENV: "production" });

// 2. Static assets and migrations next to server.js.
cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
if (existsSync(path.join(root, "public"))) cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
cpSync(path.join(root, "drizzle"), path.join(out, "drizzle"), { recursive: true });
// Not needed in production (embedded dev database, image optimiser binaries built for this PC).
for (const p of ["node_modules/@electric-sql", ".next/node_modules/@electric-sql", "node_modules/sharp", "node_modules/@img"]) rmSync(path.join(out, p), { recursive: true, force: true });

// 3. Maintenance commands bundled into single files (migrate, reference seed, first admin).
await build({
  entryPoints: { migrate: "scripts/migrate.ts", "seed-reference": "scripts/seed.ts", "create-admin": "scripts/create-admin.ts" },
  outdir: path.join(out, "ops"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  alias: { "@electric-sql/pglite": path.join(root, "scripts/stubs/pglite.mjs"), "@": path.join(root, "src") },
  external: ["pg-native"],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});

// 4. Passenger loads its startup file with require(); this CommonJS shim starts the ESM server.
writeFileSync(path.join(out, "passenger.cjs"), "// Startup file for cPanel Setup Node.js App (Passenger).\nimport('./server.js');\n");

// 5. package.json with the commands cPanel's "Run JS script" can run.
const pkg = JSON.parse(readFileSync(path.join(out, "package.json"), "utf8"));
const deployPkg = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  type: "module",
  scripts: {
    start: "node server.js",
    "db:migrate": "node ops/migrate.mjs",
    "db:seed-reference": "NODE_ENV=production node ops/seed-reference.mjs",
    "admin:create": "node ops/create-admin.mjs",
  },
};
writeFileSync(path.join(out, "package.json"), JSON.stringify(deployPkg, null, 2));
writeFileSync(
  path.join(out, "DEPLOY.txt"),
  "Synclytics web app — shared hosting bundle. Follow docs/deploy-inmotion.md (Power plan section).\n" +
    "Startup file: passenger.cjs · Node 22+ · environment variables set in cPanel (never upload .env.local).\n",
);
rmSync(path.join(out, ".env.local"), { force: true }); // never ship local secrets
rmSync(path.join(out, ".env"), { force: true });
// Guard: a broad file trace could pull source, tests, local data or secrets into the bundle.
for (const p of [".env.local", ".env.production", ".env", ".data", "src", "tests", "logo", "scripts"]) {
  if (existsSync(path.join(out, p))) throw new Error(`Refusing to package: unexpected "${p}" in the bundle (check for dynamic filesystem paths).`);
}

// 6. cPanel Git Version Control deployment hook (used when the deploy branch is cloned on the server).
cpSync(path.join(root, "deploy-hooks"), path.join(out, "deploy-hooks"), { recursive: true });
writeFileSync(
  path.join(out, ".cpanel.yml"),
  "---\ndeployment:\n  tasks:\n    - /bin/bash deploy-hooks/cpanel-deploy.sh\n",
);

if (process.argv.includes("--no-zip")) {
  console.log(`\nBundle ready in ${out}`);
  process.exit(0);
}

// 7. Zip it.
mkdirSync(path.join(root, "deploy"), { recursive: true });
const zip = path.join("deploy", `ses-shared-${new Date().toISOString().slice(0, 10)}.zip`);
rmSync(zip, { force: true });
run(`tar -a -c -f "${zip}" -C "${out}" .`);
console.log(`\nBundle ready: ${zip}`);
