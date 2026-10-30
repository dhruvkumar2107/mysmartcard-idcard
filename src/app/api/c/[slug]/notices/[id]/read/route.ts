import { moduleVisibleToStudent } from "@/lib/portal-config";
import { AppError } from "@/lib/errors";
import { loadTenantContext } from "@/server/context";
import { getSessionUser } from "@/server/session";
import { markNoticeRead, noticeViewer } from "@/server/services/notices";

/** Mark ONE notice as read for the signed-in student or teacher. */
export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  // Same-origin only (the session cookie is SameSite=Lax; this blocks cross-site form posts too).
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) return new Response("Forbidden", { status: 403 });
  const { slug, id } = await params;
  const user = await getSessionUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  try {
    const ctx = await loadTenantContext(user, slug);
    const v = await noticeViewer(ctx);
    if (!v || (v.kind === "student" && !moduleVisibleToStudent(ctx.portalConfig, "notices", v.student as never))) return new Response("Not found", { status: 404 });
    await markNoticeRead(ctx, v, id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof AppError) return new Response("Not found", { status: 404 });
    throw e;
  }
}