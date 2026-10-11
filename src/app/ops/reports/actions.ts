"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { summariseReport } from "@/server/modules/ai";
import { departmentReports, type DepartmentReports } from "@/server/modules/reports";
import { int, run, str, type ActionState } from "@/server/web/actions";
import { requireActor } from "@/server/web/session";
import { invalid } from "@/server/lib/errors";

const SECTIONS = ["sales", "finance", "support", "subscriptions", "projects", "operations"] as const;

/** Re-computes the section on the server (never trusts figures from the browser) and asks for a summary. */
export async function summariseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("operator");
  return run(async () => {
    const section = str(fd, "section") as (typeof SECTIONS)[number];
    if (!SECTIONS.includes(section)) throw invalid("Unknown report.");
    const days = [30, 90, 365].includes(int(fd, "days")) ? int(fd, "days") : 30;
    const db = getDb();
    const reports: DepartmentReports = await departmentReports(db, actor, days);
    const figures = reports[section];
    if (!figures) throw invalid("You cannot see this report.");
    await summariseReport(db, actor, section, { periodDays: days, ...figures });
    revalidatePath("/ops/reports");
    return "Summary ready.";
  });
}
