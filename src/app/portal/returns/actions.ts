"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { run, str, type ActionState } from "@/server/web/actions";
import { requireActor } from "@/server/web/session";
import { cancelReturn, requestReturn } from "@/server/modules/returns";

export async function requestReturnAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("customer");
  let id = "";
  const r = await run(async () => {
    const lines = fd
      .getAll("lineId")
      .map(String)
      .map((orderLineId) => ({ orderLineId, quantity: Number(str(fd, `qty-${orderLineId}`) || "0") }));
    const rma = await requestReturn(getDb(), actor, {
      orderId: str(fd, "orderId"),
      kind: str(fd, "kind") as "return" | "warranty",
      resolution: str(fd, "resolution") as "refund" | "replacement" | "repair",
      reason: str(fd, "reason"),
      lines,
    });
    id = rma.id;
  });
  if (!r.ok) return r;
  redirect(`/portal/returns/${id}`);
}

export async function cancelReturnAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("customer");
  return run(async () => {
    await cancelReturn(getDb(), actor, str(fd, "id"));
    revalidatePath(`/portal/returns/${str(fd, "id")}`);
    return "Request withdrawn.";
  });
}
