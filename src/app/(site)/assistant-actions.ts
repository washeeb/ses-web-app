"use server";

import { getDb } from "@/server/db/client";
import { askVisitorAssistant, type VisitorReply } from "@/server/modules/ai";
import { AppError } from "@/server/lib/errors";
import { clientIp } from "@/server/web/session";

export type AssistantResult = { ok: true; reply: VisitorReply } | { ok: false; message: string };

/** Website assistant turn. Server actions are same-origin only, so other sites cannot use this endpoint. */
export async function askAssistantAction(history: { role: "user" | "assistant"; content: string }[]): Promise<AssistantResult> {
  try {
    return { ok: true, reply: await askVisitorAssistant(getDb(), history, await clientIp()) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    return { ok: false, message: "The assistant is not available right now. Please use the enquiry form." };
  }
}
