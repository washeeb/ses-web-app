import { DATABASE_URL } from "./env";
import { createDb } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";

const { db, close } = createDb(DATABASE_URL);
await runMigrations(db, DATABASE_URL);
await close();
console.log("Migrations applied.");
