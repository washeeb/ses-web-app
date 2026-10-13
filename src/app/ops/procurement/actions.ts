"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { bool, int, run, str, type ActionState } from "@/server/web/actions";
import { requireActor } from "@/server/web/session";
import { invalid } from "@/server/lib/errors";
import { cancelPurchaseOrder, createPurchaseOrder, receiveGoods, saveSupplier, sendPurchaseOrder, submitPurchaseOrder } from "@/server/modules/procurement";

const ops = () => requireActor("operator");

export async function saveSupplierAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await ops();
  return run(async () => {
    await saveSupplier(getDb(), actor, str(fd, "id") || null, {
      name: str(fd, "name"),
      contactName: str(fd, "contactName"),
      email: str(fd, "email"),
      phone: str(fd, "phone"),
      address: str(fd, "address"),
      taxId: str(fd, "taxId"),
      paymentTermsDays: int(fd, "paymentTermsDays") || 0,
      notes: str(fd, "notes"),
      active: str(fd, "id") ? bool(fd, "active") : true,
    });
    revalidatePath("/ops/procurement/suppliers");
    return "Supplier saved.";
  });
}

export async function createPoAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await ops();
  let id = "";
  const r = await run(async () => {
    let lines: unknown;
    try {
      lines = JSON.parse(str(fd, "lines") || "[]");
    } catch {
      throw invalid("Could not read the order lines.");
    }
    const po = await createPurchaseOrder(getDb(), actor, {
      supplierId: str(fd, "supplierId"),
      locationId: str(fd, "locationId"),
      expectedAt: str(fd, "expectedAt"),
      notes: str(fd, "notes"),
      lines: lines as never,
    });
    id = po.id;
  });
  if (!r.ok) return r;
  redirect(`/ops/procurement/${id}`);
}

export async function poAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await ops();
  return run(async () => {
    const id = str(fd, "id");
    const op = str(fd, "op");
    let message: string;
    if (op === "submit") {
      const status = await submitPurchaseOrder(getDb(), actor, id);
      message = status === "approved" ? "Approved automatically (below the approval limit). You can now send it." : "Submitted for approval by someone else.";
    } else if (op === "send") {
      const r = await sendPurchaseOrder(getDb(), actor, id);
      message = r.emailed ? "Marked as sent and e-mailed to the supplier." : "Marked as sent. The supplier has no e-mail address, so send it to them yourself.";
    } else if (op === "cancel") {
      await cancelPurchaseOrder(getDb(), actor, id, str(fd, "reason"));
      message = "Purchase order cancelled.";
    } else throw invalid("Unknown operation.");
    revalidatePath(`/ops/procurement/${id}`);
    return message;
  });
}

export async function receiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await ops();
  return run(async () => {
    const id = str(fd, "id");
    const lines = fd
      .getAll("lineId")
      .map(String)
      .map((lineId) => ({ lineId, quantity: Number(str(fd, `qty-${lineId}`) || "0"), serials: str(fd, `serials-${lineId}`) || undefined }));
    if (lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 0)) throw invalid("Quantities must be whole numbers.");
    const r = await receiveGoods(getDb(), actor, id, { notes: str(fd, "notes"), lines });
    revalidatePath(`/ops/procurement/${id}`);
    return `Goods receipt ${r.grnNumber} recorded${r.complete ? " — order fully received" : ""}. Stock updated.`;
  });
}
