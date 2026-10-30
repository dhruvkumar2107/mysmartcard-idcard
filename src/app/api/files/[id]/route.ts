import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { coursework, files, institutions, notices, students, submissions } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { storage } from "@/lib/storage";
import { loadTenantContext, type TenantContext } from "@/server/context";
import { getSessionUser } from "@/server/session";
import { isUuid } from "@/server/services/guard";
import { getStudent } from "@/server/services/students";
import { noticeViewer, noticeVisibleTo } from "@/server/services/notices";
import { canViewTimetableFile } from "@/server/services/timetable-images";
import { submissionsFor } from "@/server/services/coursework";

/**
 * Private file download. Authorization is decided per owner type — knowing a
 * file id is never enough.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const db = getDb();
  const [f] = await db.select({ file: files, slug: institutions.slug }).from(files).innerJoin(institutions, eq(institutions.id, files.institutionId)).where(eq(files.id, id)).limit(1);
  if (!f) return new Response("Not found", { status: 404 });

  const publicFile = f.file.ownerType === "branding";
  if (!publicFile) {
    const user = await getSessionUser();
    if (!user) return new Response("Sign in required", { status: 401 });
    let ctx: TenantContext;
    try {
      ctx = await loadTenantContext(user, f.slug);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    if (!(await authorize(ctx, f.file))) return new Response("Not found", { status: 404 });
  }

  const body = await storage().get(f.file.storageKey);
  const download = new URL(req.url).searchParams.get("download") === "1";
  const inline = !download && (f.file.mimeType.startsWith("image/") || f.file.mimeType === "application/pdf");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": f.file.mimeType,
      "Content-Length": String(body.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(f.file.originalName)}"`,
      "Cache-Control": publicFile ? "public, max-age=3600" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

async function authorize(ctx: TenantContext, file: typeof files.$inferSelect): Promise<boolean> {
  const db = getDb();
  const isStudent = ctx.role === "student";
  const me = isStudent && ctx.studentId ? (await db.select().from(students).where(and(eq(students.id, ctx.studentId), eq(students.institutionId, ctx.institution.id))).limit(1))[0] : null;
  try {
    switch (file.ownerType) {
      case "student_photo":
      case "student_document":
        if (isStudent) return file.ownerId === ctx.studentId;
        await getStudent(ctx, file.ownerId!); // enforces role scope
        return true;
      case "notice": {
        if (ctx.perms.has("notices.publish")) return true;
        const [n] = await db.select().from(notices).where(and(eq(notices.id, file.ownerId!), eq(notices.institutionId, ctx.institution.id))).limit(1);
        const viewer = await noticeViewer(ctx);
        return !!viewer && !!n && n.status === "published" && noticeVisibleTo(n, viewer);
      }
      case "timetable_image":
        return canViewTimetableFile(ctx, file, me);
      case "coursework": {
        const [cw] = await db.select().from(coursework).where(and(eq(coursework.id, file.ownerId!), eq(coursework.institutionId, ctx.institution.id))).limit(1);
        if (!cw) return false;
        if (me) return me.sectionId === cw.sectionId && cw.status === "published";
        await submissionsFor(ctx, cw.id); // throws unless the staff member manages this class
        return true;
      }
      case "submission": {
        const [sub] = await db.select().from(submissions).where(and(eq(submissions.fileId, file.id), eq(submissions.institutionId, ctx.institution.id))).limit(1);
        if (me) return !!sub && sub.studentId === me.id;
        if (!file.ownerId) return false;
        await submissionsFor(ctx, file.ownerId);
        return true;
      }
      default:
        return false;
    }
  } catch (e) {
    if (e instanceof AppError) return false;
    throw e;
  }
}
