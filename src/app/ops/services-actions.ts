"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { bool, int, run, str, type ActionState } from "@/server/web/actions";
import { requireActor } from "@/server/web/session";
import { assignTicket, createTicket, escalateTicket, replyToTicket, setTicketPriority, setTicketStatus } from "@/server/modules/tickets";
import { cancelContract, cancelSubscription, createContract, createSubscription, setAutoRenew } from "@/server/modules/subscriptions";
import { addMilestone, addTask, createProject, decideSignoff, requestSignoff, setProjectStatus, setTaskStatus } from "@/server/modules/projects";
import { createAsset, updateAsset } from "@/server/modules/assets";
import { PRIORITIES } from "@/server/modules/service-time";
import { suggestForTicket } from "@/server/modules/ai";

type Prev = ActionState;
const ops = () => requireActor("operator");

// ── Support ──

export async function createTicketAction(_: Prev, fd: FormData) {
  const actor = await ops();
  let id = "";
  const r = await run(async () => {
    const t = await createTicket(getDb(), actor, {
      customerOrgId: str(fd, "customerOrgId"),
      subject: str(fd, "subject"),
      description: str(fd, "description"),
      priority: str(fd, "priority") as never,
      category: str(fd, "category") as never,
      assetId: str(fd, "assetId") || null,
    });
    id = t.id;
  });
  if (!r.ok) return r;
  redirect(`/ops/support/${id}`);
}

export async function ticketReplyAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await replyToTicket(getDb(), actor, str(fd, "id"), str(fd, "body"), { internal: bool(fd, "internal") });
    revalidatePath(`/ops/support/${str(fd, "id")}`);
    return bool(fd, "internal") ? "Internal note added." : "Reply sent to the customer.";
  });
}

export async function ticketUpdateAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const id = str(fd, "id");
    const db = getDb();
    switch (str(fd, "op")) {
      case "status":
        await setTicketStatus(db, actor, id, str(fd, "status"));
        break;
      case "assign":
        await assignTicket(db, actor, id, str(fd, "assigneeUserId") || null);
        break;
      case "priority":
        await setTicketPriority(db, actor, id, str(fd, "priority"));
        break;
      case "escalate":
        await escalateTicket(db, actor, id, str(fd, "reason"));
        break;
    }
    revalidatePath(`/ops/support/${id}`);
    return "Ticket updated.";
  });
}

export async function aiSuggestAction(_: Prev, fd: FormData) {
  const actor = await ops();
  const id = str(fd, "id");
  const r = await run(async () => {
    await suggestForTicket(getDb(), actor, id);
  });
  if (!r.ok) return r;
  redirect(`/ops/support/${id}?draft=ai#reply`);
}

// ── Subscriptions & contracts ──

export async function createSubscriptionAction(_: Prev, fd: FormData) {
  const actor = await ops();
  let id = "";
  const r = await run(async () => {
    const s = await createSubscription(getDb(), actor, {
      customerOrgId: str(fd, "customerOrgId"),
      variantId: str(fd, "variantId"),
      quantity: int(fd, "quantity"),
      startsOn: str(fd, "startsOn"),
      autoRenew: bool(fd, "autoRenew"),
    });
    id = s.id;
  });
  if (!r.ok) return r;
  redirect(`/ops/subscriptions/${id}`);
}

export async function subscriptionAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const id = str(fd, "id");
    if (str(fd, "op") === "cancel") await cancelSubscription(getDb(), actor, id, str(fd, "reason"));
    else await setAutoRenew(getDb(), actor, id, str(fd, "autoRenew") === "true");
    revalidatePath(`/ops/subscriptions/${id}`);
    return "Subscription updated.";
  });
}

export async function createContractAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const targets = Object.fromEntries(
      PRIORITIES.map((p) => [p, { responseHours: Number(str(fd, `${p}Response`)), resolutionHours: Number(str(fd, `${p}Resolution`)) }]),
    );
    const c = await createContract(getDb(), actor, {
      customerOrgId: str(fd, "customerOrgId"),
      name: str(fd, "name"),
      coverage: str(fd, "coverage") as never,
      startsOn: str(fd, "startsOn"),
      endsOn: str(fd, "endsOn"),
      targets: targets as never,
      notes: str(fd, "notes"),
    });
    revalidatePath("/ops/contracts");
    return `Contract ${c.number} created.`;
  });
}

export async function cancelContractAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await cancelContract(getDb(), actor, str(fd, "id"), str(fd, "reason"));
    revalidatePath("/ops/contracts");
    return "Contract cancelled.";
  });
}

// ── Projects ──

export async function createProjectAction(_: Prev, fd: FormData) {
  const actor = await ops();
  let id = "";
  const r = await run(async () => {
    const p = await createProject(getDb(), actor, {
      name: str(fd, "name"),
      customerOrgId: str(fd, "customerOrgId") || null,
      description: str(fd, "description"),
      managerUserId: str(fd, "managerUserId") || undefined,
      startDate: str(fd, "startDate"),
      dueDate: str(fd, "dueDate"),
    });
    id = p.id;
  });
  if (!r.ok) return r;
  redirect(`/ops/projects/${id}`);
}

export async function projectAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    const db = getDb();
    const id = str(fd, "projectId");
    let msg = "Project updated.";
    switch (str(fd, "op")) {
      case "status":
        await setProjectStatus(db, actor, id, str(fd, "status"));
        break;
      case "milestone":
        await addMilestone(db, actor, id, { name: str(fd, "name"), dueDate: str(fd, "dueDate") });
        msg = "Milestone added.";
        break;
      case "task":
        await addTask(db, actor, id, { title: str(fd, "title"), milestoneId: str(fd, "milestoneId") || null, assigneeUserId: str(fd, "assigneeUserId") || null, dueDate: str(fd, "dueDate") });
        msg = "Task added.";
        break;
      case "task_status":
        await setTaskStatus(db, actor, str(fd, "taskId"), str(fd, "status"));
        break;
      case "request_signoff":
        await requestSignoff(db, actor, str(fd, "milestoneId"));
        msg = "Sign-off requested.";
        break;
      case "signoff":
        await decideSignoff(db, actor, str(fd, "milestoneId"), str(fd, "decision") === "approve", str(fd, "note"));
        msg = "Decision recorded.";
        break;
    }
    revalidatePath(`/ops/projects/${id}`);
    return msg;
  });
}

// ── Assets ──

const assetFields = (fd: FormData) => ({
  name: str(fd, "name"),
  serialNumber: str(fd, "serialNumber"),
  location: str(fd, "location"),
  status: (str(fd, "status") || "active") as never,
  contractId: str(fd, "contractId") || null,
  notes: str(fd, "notes"),
});

export async function createAssetAction(_: Prev, fd: FormData) {
  const actor = await ops();
  let id = "";
  const r = await run(async () => {
    id = (await createAsset(getDb(), actor, str(fd, "customerOrgId"), assetFields(fd))).id;
  });
  if (!r.ok) return r;
  redirect(`/ops/assets/${id}`);
}

export async function updateAssetAction(_: Prev, fd: FormData) {
  const actor = await ops();
  return run(async () => {
    await updateAsset(getDb(), actor, str(fd, "id"), assetFields(fd));
    revalidatePath(`/ops/assets/${str(fd, "id")}`);
    return "Asset saved.";
  });
}
