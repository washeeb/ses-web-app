"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { markRead } from "@/server/modules/notifications";
import { run, str, type ActionState } from "@/server/web/actions";
import { getSessionState } from "@/server/web/session";
import { redirect } from "next/navigation";

export async function markNotificationsRead(_: ActionState, fd: FormData): Promise<ActionState> {
  const state = await getSessionState();
  if (!state || state.pending) redirect("/login");
  return run(async () => {
    await markRead(getDb(), state.actor, str(fd, "id") || null);
    revalidatePath(str(fd, "path") || "/");
    return "Marked as read.";
  });
}
