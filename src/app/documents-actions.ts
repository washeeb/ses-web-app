"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { deleteDocument, uploadDocument } from "@/server/modules/documents";
import { invalid } from "@/server/lib/errors";
import { run, str, type ActionState } from "@/server/web/actions";
import { requireActor } from "@/server/web/session";

export async function uploadDocumentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("operator");
  return run(async () => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw invalid("Choose a file to upload.");
    await uploadDocument(getDb(), actor, {
      entityType: str(fd, "entityType"),
      entityId: str(fd, "entityId"),
      fileName: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
      visibility: str(fd, "visibility"),
    });
    revalidatePath(str(fd, "path") || "/ops");
    return "Document uploaded.";
  });
}

export async function deleteDocumentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("operator");
  return run(async () => {
    await deleteDocument(getDb(), actor, str(fd, "id"));
    revalidatePath(str(fd, "path") || "/ops");
    return "Document removed.";
  });
}
