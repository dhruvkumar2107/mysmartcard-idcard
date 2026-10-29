import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import type { Permission } from "@/lib/permissions";
import { SESSION_COOKIE, SESSION_TTL_MS, userForSessionToken } from "./auth";
import { loadTenantContext } from "./context";

export const getSessionUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return userForSessionToken(token);
});

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireSuperAdmin() {
  const user = await requireUser();
  if (!user.isSuperAdmin) redirect("/denied?reason=platform");
  return user;
}

const tenantContext = cache(async (slug: string) => {
  const user = await getSessionUser();
  if (!user) return { error: "unauthenticated" as const };
  try {
    return { ctx: await loadTenantContext(user, slug) };
  } catch (e) {
    if (e instanceof AppError) return { error: e.code, message: e.message };
    throw e;
  }
});

/** For pages: resolves tenant context or redirects/404s. */
export async function requireTenant(slug: string, perm?: Permission) {
  const res = await tenantContext(slug);
  if ("error" in res) {
    if (res.error === "unauthenticated") redirect(`/login?next=/c/${encodeURIComponent(slug)}`);
    if (res.error === "not_found") notFound();
    redirect(`/denied?reason=${encodeURIComponent(res.message ?? "forbidden")}`);
  }
  const { ctx } = res;
  if (perm && !ctx.perms.has(perm)) redirect(`/denied?reason=${encodeURIComponent("Your role does not include access to this section.")}`);
  return ctx;
}

/** For pages: any authorization/lookup failure on a specific record renders a 404 (no existence oracle). */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
    domain: process.env.COOKIE_DOMAIN || undefined,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete({ name: SESSION_COOKIE, path: "/", domain: process.env.COOKIE_DOMAIN || undefined });
}

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
