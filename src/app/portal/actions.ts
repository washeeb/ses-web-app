"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { acceptQuote, declineQuote } from "@/server/modules/sales";
import { run, str, type ActionState } from "@/server/web/actions";
import { appUrl, requireActor } from "@/server/web/session";
import { redirect } from "next/navigation";
import { startPaystackCheckout } from "@/server/modules/payments/paystack";

export async function respondToQuote(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("customer");
  return run(async () => {
    const id = str(fd, "id");
    if (str(fd, "decision") === "accept") {
      const order = await acceptQuote(getDb(), actor, id);
      revalidatePath(`/portal/quotes/${id}`);
      return `Thank you. Order ${order.number} has been created and stock is reserved while we confirm it.`;
    }
    await declineQuote(getDb(), actor, id);
    revalidatePath(`/portal/quotes/${id}`);
    return "Quotation declined.";
  });
}

export async function payOrderAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("customer");
  let url = "";
  const r = await run(async () => {
    url = await startPaystackCheckout(getDb(), actor, str(fd, "id"), appUrl());
  });
  if (!r.ok) return r;
  redirect(url);
}
