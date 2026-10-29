import { and, eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { getDb, type Executor } from "@/db";
import { notFound } from "@/lib/errors";
import type { TenantContext } from "../context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

type TenantTable = PgTable & { id: PgColumn; institutionId: PgColumn };

/**
 * Fetch a row by id ONLY if it belongs to the caller's college. Every id that
 * arrives from a form, URL or API request goes through this (or an equivalent
 * institution-scoped WHERE) before use — this is what defeats IDOR attempts.
 */
export async function owned<T extends TenantTable>(
  ctx: Pick<TenantContext, "institution">,
  table: T,
  id: string | null | undefined,
  what = "Record",
  tx: Executor = getDb(),
): Promise<T["$inferSelect"]> {
  if (!isUuid(id)) throw notFound(what);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (tx as any)
    .select()
    .from(table)
    .where(and(eq(table.id, id), eq(table.institutionId, ctx.institution.id)))
    .limit(1);
  if (!rows[0]) throw notFound(what);
  return rows[0] as T["$inferSelect"];
}

/** Same as `owned` but allows null/empty (optional foreign keys). */
export async function ownedOrNull<T extends TenantTable>(ctx: Pick<TenantContext, "institution">, table: T, id: string | null | undefined, what?: string, tx?: Executor) {
  if (!id) return null;
  return owned(ctx, table, id, what, tx);
}
