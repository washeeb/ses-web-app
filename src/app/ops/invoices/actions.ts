"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { invalid } from "@/server/lib/errors";
import { parseMoney } from "@/server/lib/money";
import { issueInvoice, recordManualPayment, reverseManualPayment, voidInvoice } from "@/server/modules/invoices";
import { run, str, type ActionState } from "@/server/web/actions";
import { requireActor } from "@/server/web/session";

const ops = () => requireActor("operator");

export async function recordPaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await ops();
  return run(async () => {
    const amountMinor = parseMoney(str(fd, "amount"));
    if (amountMinor === null) throw invalid("Enter an amount such as 1250.00");
    await recordManualPayment(getDb(), actor, str(fd, "id"), {
      amountMinor,
      method: str(fd, "method") as never,
      externalReference: str(fd, "externalReference"),
      paidOn: str(fd, "paidOn"),
      note: str(fd, "note"),
    });
    revalidatePath(`/ops/invoices/${str(fd, "id")}`);
    return "Payment recorded.";
  });
}

export async function reversePaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await ops();
  return run(async () => {
    await reverseManualPayment(getDb(), actor, str(fd, "paymentId"), str(fd, "reason"));
    revalidatePath(`/ops/invoices/${str(fd, "id")}`);
    return "Payment reversed.";
  });
}

export async function voidInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await ops();
  return run(async () => {
    await voidInvoice(getDb(), actor, str(fd, "id"), str(fd, "reason"));
    revalidatePath(`/ops/invoices/${str(fd, "id")}`);
    return "Invoice voided.";
  });
}

export async function issueInvoiceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await ops();
  let id = "";
  const r = await run(async () => {
    id = (await issueInvoice(getDb(), actor, str(fd, "orderId"))).id;
  });
  if (!r.ok) return r;
  redirect(`/ops/invoices/${id}`);
}
