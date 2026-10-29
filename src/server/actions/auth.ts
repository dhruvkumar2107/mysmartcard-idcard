"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { authenticate, createSession, destroySession, hashPassword, SESSION_COOKIE, verifyPassword } from "../auth";
import { clearSessionCookie, clientIp, setSessionCookie } from "../session";
import { userAction, withFlash } from "../action";
import { AppError } from "@/lib/errors";

function safeNext(v: FormDataEntryValue | null) {
  const s = String(v ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

export async function login(fd: FormData) {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const next = safeNext(fd.get("next"));
  const ip = await clientIp();
  const back = `/login?next=${encodeURIComponent(next)}`;

  // Two buckets: per IP and per account, so neither spraying nor targeted guessing scales.
  const a = await rateLimit(`login:ip:${ip}`, 20, 15 * 60_000);
  const b = await rateLimit(`login:acct:${email}`, 8, 15 * 60_000);
  if (!a.ok || !b.ok) redirect(withFlash(back, `Too many sign-in attempts. Try again in ${Math.max(a.retryAfterSec, b.retryAfterSec)} seconds.`, "err"));

  const user = email && password ? await authenticate(email, password) : null;
  if (!user) redirect(withFlash(back, "Incorrect email or password.", "err"));

  const token = await createSession(user.id, { ip, userAgent: (await headers()).get("user-agent") });
  await setSessionCookie(token);
  if (user.mustChangePassword) redirect(`/account/password?next=${encodeURIComponent(next)}`);
  redirect(next);
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  await clearSessionCookie();
  redirect("/login");
}

export async function changePassword(fd: FormData) {
  return userAction(fd, "/account/password", async (user) => {
    const current = String(fd.get("current") ?? "");
    const next = String(fd.get("password") ?? "");
    const confirm = String(fd.get("confirm") ?? "");
    if (next.length < 10) throw new AppError("Use at least 10 characters.");
    if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) throw new AppError("Use a mix of letters and numbers.");
    if (next !== confirm) throw new AppError("Passwords do not match.");
    const [row] = await getDb().select().from(users).where(eq(users.id, user.id));
    if (!(await verifyPassword(current, row.passwordHash))) throw new AppError("Current password is incorrect.");
    await getDb().update(users).set({ passwordHash: await hashPassword(next), mustChangePassword: false }).where(eq(users.id, user.id));
    return { message: "Password updated.", to: safeNext(fd.get("next")) };
  });
}
