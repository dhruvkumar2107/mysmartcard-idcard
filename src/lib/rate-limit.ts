import { lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { rateLimits } from "@/db/schema";
import { sha256 } from "./crypto";

/**
 * Fixed-window rate limiter backed by Postgres, so limits hold across every
 * serverless instance. One atomic upsert per check: an expired window restarts
 * at 1, otherwise the counter increments.
 *
 * Fails open if the database is unreachable — the request would fail on its
 * next query anyway, and locking everyone out is worse than a brief gap.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<{ ok: boolean; retryAfterSec: number }> {
  const resetAt = new Date(Date.now() + windowMs);
  try {
    const [row] = await getDb()
      .insert(rateLimits)
      .values({ key: sha256(key), count: 1, resetAt })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`case when ${rateLimits.resetAt} <= now() then 1 else ${rateLimits.count} + 1 end`,
          resetAt: sql`case when ${rateLimits.resetAt} <= now() then excluded.reset_at else ${rateLimits.resetAt} end`,
        },
      })
      .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt });
    if (row.count <= limit) return { ok: true, retryAfterSec: 0 };
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((row.resetAt.getTime() - Date.now()) / 1000)) };
  } catch (e) {
    console.error("[rate-limit] store unavailable, allowing request", e);
    return { ok: true, retryAfterSec: 0 };
  }
}

/** Removes counters whose window has ended. Returns how many were deleted. */
export async function sweepRateLimits(): Promise<number> {
  const rows = await getDb().delete(rateLimits).where(lt(rateLimits.resetAt, new Date())).returning({ key: rateLimits.key });
  return rows.length;
}

/** Test hook. */
export async function resetRateLimits() {
  await getDb().delete(rateLimits);
}
