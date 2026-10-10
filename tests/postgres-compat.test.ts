import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { setupDb } from "./helpers";
import type { DB } from "@/server/db/client";
import { permissionSets, roleAssignments, users } from "@/server/db/schema";

// The InMotion shared server runs PostgreSQL older than 15 (see docs/deploy-inmotion.md).
const sql = readdirSync("drizzle")
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(`drizzle/${f}`, "utf8"))
  .join("\n");

describe("migrations stay compatible with the production PostgreSQL", () => {
  it("use no PostgreSQL 13+/15+ only features", () => {
    expect(sql).not.toMatch(/NULLS NOT DISTINCT/i); // PG 15+
    expect(sql).not.toMatch(/gen_random_uuid/i); // core only from PG 13; IDs are generated in the app
    expect(sql).not.toMatch(/\bMERGE\b|JSON_TABLE|GENERATED ALWAYS AS \(/i);
  });
});

describe("role assignment uniqueness without NULLS NOT DISTINCT", () => {
  let db: DB;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await setupDb()));
  afterAll(() => close());

  it("treats a missing department as a value, so the same grant cannot be duplicated", async () => {
    const [u] = await db.select().from(users).where(eq(users.email, "engineer@ses.demo"));
    const [set] = await db.select().from(permissionSets).where(eq(permissionSets.key, "auditor"));
    const row = { userId: u!.id, permissionSetId: set!.id, organizationId: u!.organizationId, departmentId: null };
    await db.insert(roleAssignments).values(row);
    await expect(db.insert(roleAssignments).values(row)).rejects.toThrow();
    expect(await db.insert(roleAssignments).values(row).onConflictDoNothing().returning()).toEqual([]);
  });
});
