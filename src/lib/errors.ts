export class AppError extends Error {
  constructor(
    message: string,
    public code: "bad_request" | "unauthorized" | "forbidden" | "not_found" | "conflict" | "rate_limited" = "bad_request",
  ) {
    super(message);
  }
}

export const forbidden = (msg = "You do not have permission to perform this action.") => new AppError(msg, "forbidden");
export const notFound = (what = "Record") => new AppError(`${what} not found.`, "not_found");
export const badRequest = (msg: string) => new AppError(msg, "bad_request");

/** Map Postgres unique-violation errors to a readable message. */
export function describeDbError(err: unknown): string | null {
  const e = err as { code?: string; cause?: { code?: string; constraint?: string }; constraint?: string };
  const code = e?.code ?? e?.cause?.code;
  if (code === "23505") return "A record with the same unique value already exists.";
  if (code === "23503") return "This record is referenced by other data and cannot be changed that way.";
  return null;
}
