"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { run, str, type ActionState } from "@/server/web/actions";
import { requireActor } from "@/server/web/session";
import { createTicket, replyToTicket } from "@/server/modules/tickets";
import { setAutoRenew } from "@/server/modules/subscriptions";
import { decideSignoff } from "@/server/modules/projects";

type Prev = ActionState;
const customer = () => requireActor("customer");

export async function raiseTicketAction(_: Prev, fd: FormData) {
  const actor = await customer();
  let id = "";
  const r = await run(async () => {
    const t = await createTicket(getDb(), actor, {
      subject: str(fd, "subject"),
      description: str(fd, "description"),
      priority: str(fd, "priority") as never,
      category: str(fd, "category") as never,
      assetId: str(fd, "assetId") || null,
    });
    id = t.id;
  });
  if (!r.ok) return r;
  redirect(`/portal/support/${id}?raised=1`);
}

export async function customerReplyAction(_: Prev, fd: FormData) {
  const actor = await customer();
  return run(async () => {
    await replyToTicket(getDb(), actor, str(fd, "id"), str(fd, "body"));
    revalidatePath(`/portal/support/${str(fd, "id")}`);
    return "Message sent.";
  });
}

export async function autoRenewAction(_: Prev, fd: FormData) {
  const actor = await customer();
  return run(async () => {
    const on = str(fd, "autoRenew") === "true";
    await setAutoRenew(getDb(), actor, str(fd, "id"), on);
    revalidatePath("/portal/subscriptions");
    return on ? "Automatic renewal turned on." : "Automatic renewal turned off. The subscription ends at the end of the current period.";
  });
}

export async function signoffAction(_: Prev, fd: FormData) {
  const actor = await customer();
  return run(async () => {
    await decideSignoff(getDb(), actor, str(fd, "milestoneId"), str(fd, "decision") === "approve", str(fd, "note"));
    revalidatePath(`/portal/projects/${str(fd, "projectId")}`);
    return str(fd, "decision") === "approve" ? "Milestone signed off. Thank you." : "Sent back to the project team with your comments.";
  });
}
