"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/lib/errors";
import { applyProductImport, previewProductImport, type ImportRow } from "@/server/modules/csv";
import { requireActor } from "@/server/web/session";

export type ImportResult =
  | { ok: true; mode: "preview"; rows: ImportRow[] }
  | { ok: true; mode: "apply"; summary: Awaited<ReturnType<typeof applyProductImport>> }
  | { ok: false; message: string };

export async function importProducts(text: string, apply: boolean): Promise<ImportResult> {
  const actor = await requireActor("operator");
  try {
    if (apply) {
      const summary = await applyProductImport(getDb(), actor, text);
      revalidatePath("/ops/catalogue");
      return { ok: true, mode: "apply", summary };
    }
    return { ok: true, mode: "preview", rows: await previewProductImport(getDb(), actor, text) };
  } catch (err) {
    if (err instanceof AppError) return { ok: false, message: err.message };
    throw err;
  }
}
