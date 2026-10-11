"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db/client";
import { deleteArticle, saveArticle } from "@/server/modules/knowledge";
import { run, str, type ActionState } from "@/server/web/actions";
import { requireActor } from "@/server/web/session";

export async function saveArticleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("operator");
  const id = str(fd, "id") || null;
  let target = "";
  const r = await run(async () => {
    const a = await saveArticle(getDb(), actor, id, {
      title: str(fd, "title"),
      summary: str(fd, "summary"),
      body: String(fd.get("body") ?? ""),
      category: str(fd, "category") as never,
      audience: str(fd, "audience") as never,
      status: str(fd, "status") as never,
    });
    revalidatePath("/ops/knowledge");
    revalidatePath("/help");
    if (!id) target = `/ops/knowledge/${a.id}`;
  });
  if (!r.ok || !target) return r.ok ? { ...r, message: "Article saved." } : r;
  redirect(target);
}

export async function deleteArticleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("operator");
  const r = await run(async () => {
    await deleteArticle(getDb(), actor, str(fd, "id"));
  });
  if (!r.ok) return r;
  redirect("/ops/knowledge");
}
