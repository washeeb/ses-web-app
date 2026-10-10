export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "mfa_required"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  mfa_required: 403,
  not_found: 404,
  validation: 400,
  conflict: 409,
  rate_limited: 429,
};

/** An error whose message is safe to show to the user. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
  get status() {
    return STATUS[this.code];
  }
}

export const forbidden = (msg = "You do not have permission to do that.") => new AppError("forbidden", msg);
export const notFound = (msg = "Not found.") => new AppError("not_found", msg);
export const invalid = (msg: string) => new AppError("validation", msg);
export const conflict = (msg: string) => new AppError("conflict", msg);
