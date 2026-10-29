import bcrypt from "bcryptjs";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, users } from "@/db/schema";
import { generateToken, sha256 } from "@/lib/crypto";

export const SESSION_COOKIE = "msc_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12h, sliding

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/** A constant-cost dummy compare so unknown emails take as long as wrong passwords. */
const DUMMY_HASH = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5u7oF1Jc5bZb8pQz0Wl8b0M1x3m2bVe";

export async function authenticate(email: string, password: string) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || user.status !== "active") return null;
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return user;
}

export async function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
  const token = generateToken();
  await getDb()
    .insert(sessions)
    .values({ id: sha256(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS), ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 255) ?? null });
  return token;
}

export async function userForSessionToken(token: string) {
  const db = getDb();
  const id = sha256(token);
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || row.user.status !== "active") return null;
  // Slide expiry when more than an hour has elapsed.
  if (row.session.expiresAt.getTime() - Date.now() < SESSION_TTL_MS - 60 * 60 * 1000) {
    await db.update(sessions).set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) }).where(eq(sessions.id, id));
  }
  const { passwordHash: _omit, ...user } = row.user;
  void _omit;
  return user;
}

export async function destroySession(token: string) {
  await getDb().delete(sessions).where(eq(sessions.id, sha256(token)));
}

export async function destroyAllSessionsForUser(userId: string) {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
}

export async function purgeExpiredSessions() {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof userForSessionToken>>>;
