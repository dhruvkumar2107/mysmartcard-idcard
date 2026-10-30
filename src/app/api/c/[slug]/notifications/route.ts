import { moduleVisibleToStudent } from "@/lib/portal-config";
import { AppError } from "@/lib/errors";
import { loadTenantContext } from "@/server/context";
import { getSessionUser } from "@/server/session";
import { noticeViewer, notificationSummary, type NoticeViewer } from "@/server/services/notices";

/**
 * In-app notification feed for the bell (students: student notices; teachers: teacher notices).
 * Polled by the client; never cached. Not a device push notification.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const ctx = await loadTenantContext(user, slug);
    const v: NoticeViewer | null = await noticeViewer(ctx);
    if (!v || (v.kind === "student" && !moduleVisibleToStudent(ctx.portalConfig, "notices", v.student as never))) return json({ unread: 0, items: [] });
    return json(await notificationSummary(ctx, v));
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.code }, { status: 403 });
    throw e;
  }
}

function json(body: unknown) {
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}