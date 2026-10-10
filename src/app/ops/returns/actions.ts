"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { bool, run, str, type ActionState } from "@/server/web/actions";
import { requireActor } from "@/server/web/session";
import { invalid } from "@/server/lib/errors";
import { completeReturn, decideReturn, receiveReturn } from "@/server/modules/returns";

export async function returnStaffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("operator");
  return run(async () => {
    const id = str(fd, "id");
    const op = str(fd, "op");
    let msg: string;
    if (op === "approve" || op === "reject") {
      await decideReturn(getDb(), actor, id, op === "approve", str(fd, "note"));
      msg = op === "approve" ? "Approved. The customer has been notified." : "Rejected. The customer has been notified.";
    } else if (op === "receive") {
      await receiveReturn(getDb(), actor, id, { restock: bool(fd, "restock"), locationId: str(fd, "locationId") || null });
      msg = "Recorded as received.";
    } else if (op === "complete") {
      await completeReturn(getDb(), actor, id, str(fd, "note"));
      msg = "Marked as completed.";
    } else throw invalid("Unknown operation.");
    revalidatePath(`/ops/returns/${id}`);
    return msg;
  });
}
