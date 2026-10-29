import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AppError, describeDbError } from "@/lib/errors";
import { getSessionUser } from "./session";
import { loadTenantContext, type TenantContext } from "./context";

export type ActionResult = void | string | { message?: string; to?: string };

function safeBack(fd: FormData, fallback: string) {
  const back = String(fd.get("_back") ?? "");
  // Only same-origin relative paths; blocks open redirects like //evil.com
  return back.startsWith("/") && !back.startsWith("//") ? back : fallback;
}

export function withFlash(path: string, message: string, kind: "ok" | "err") {
  const [base, hash] = path.split("#");
  const url = new URL(base, "http://x");
  url.searchParams.set("flash", message.slice(0, 300));
  url.searchParams.set("kind", kind);
  return url.pathname + url.search + (hash ? `#${hash}` : "");
}

function errorMessage(e: unknown): string {
  if (e instanceof AppError) return e.message;
  if (e instanceof z.ZodError) return e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
  const db = describeDbError(e);
  if (db) return db;
  console.error("[action] unexpected error", e);
  return "Something went wrong. Please try again.";
}

async function finish(fd: FormData, fallback: string, fn: () => Promise<ActionResult>) {
  const back = safeBack(fd, fallback);
  let result: ActionResult;
  try {
    result = await fn();
  } catch (e) {
    redirect(withFlash(back, errorMessage(e), "err"));
  }
  const message = typeof result === "string" ? result : result?.message;
  const to = typeof result === "object" && result?.to ? result.to : back;
  revalidatePath(to.split("?")[0]);
  redirect(message ? withFlash(to, message, "ok") : to);
}

/**
 * Wrap a tenant-scoped server action. The college is identified by the `_slug`
 * form field, but authorization is re-derived from the session on every call —
 * a tampered slug only ever yields "not a member".
 */
export async function tenantAction(fd: FormData, fn: (ctx: TenantContext) => Promise<ActionResult>) {
  const slug = String(fd.get("_slug") ?? "");
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return finish(fd, `/c/${slug}`, async () => fn(await loadTenantContext(user, slug)));
}

export async function userAction(fd: FormData, fallback: string, fn: (user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>) => Promise<ActionResult>) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return finish(fd, fallback, () => fn(user));
}

// ---------------------------------------------------------------- FormData helpers

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const optStr = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" ? null : v;
};
export const int = (fd: FormData, k: string) => {
  const n = Number(str(fd, k));
  if (!Number.isInteger(n)) throw new AppError(`${k} must be a whole number`);
  return n;
};
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
export const list = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);
