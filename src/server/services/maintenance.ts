import { and, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { notificationOutbox, sessions } from "@/db/schema";
import { sweepRateLimits } from "@/lib/rate-limit";

/** Finished outbox rows are kept this long for troubleshooting, then dropped. Queued rows are never touched. */
export const OUTBOX_RETENTION_DAYS = 90;

/**
 * Data-retention sweep, run daily by the Vercel cron (see vercel.json).
 * Only removes data that has no further use: expired sessions, ended
 * rate-limit windows and old delivered/skipped notification records.
 * Academic records, audit logs and support grants are never deleted here.
 */
export async function runRetention(now = new Date()) {
  const db = getDb();
  const expiredSessions = await db.delete(sessions).where(lt(sessions.expiresAt, now)).returning({ id: sessions.id });
  const rateLimitRows = await sweepRateLimits();
  const outboxCutoff = new Date(now.getTime() - OUTBOX_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const outbox = await db
    .delete(notificationOutbox)
    .where(and(lt(notificationOutbox.createdAt, outboxCutoff), inArray(notificationOutbox.status, ["sent", "skipped_unconfigured", "failed"])))
    .returning({ id: notificationOutbox.id });
  return { expiredSessions: expiredSessions.length, rateLimitRows, outboxRows: outbox.length };
}
