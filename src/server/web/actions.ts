import "server-only";
import { ZodError } from "zod";
import { unstable_rethrow } from "next/navigation";
import { AppError } from "../lib/errors";
import { log } from "../lib/log";

export interface ActionState {
  ok: boolean;
  message?: string;
  /** Shown once, e.g. a newly created secret. */
  secret?: string;
  at?: number;
}

export const initialState: ActionState = { ok: false };

/** Runs a mutation and converts known errors into user-safe messages. */
export async function run(fn: () => Promise<string | Partial<ActionState> | void>): Promise<ActionState> {
  try {
    const r = await fn();
    if (typeof r === "string") return { ok: true, message: r, at: Date.now() };
    return { ok: true, at: Date.now(), ...(r ?? {}) };
  } catch (err) {
    unstable_rethrow(err); // let redirect()/notFound() through
    if (err instanceof AppError) return { ok: false, message: err.message, at: Date.now() };
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return { ok: false, message: first ? `${first.path.join(".") || "Input"}: ${first.message}` : "Invalid input.", at: Date.now() };
    }
    log.error("action.failed", { error: err instanceof Error ? err.stack : String(err) });
    return { ok: false, message: "Something went wrong. Please try again.", at: Date.now() };
  }
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const int = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" ? NaN : Number(v);
};
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
/** "12.5" (percent) → 1250 basis points */
export const percentToBp = (v: string) => Math.round(Number(v || "0") * 100);
