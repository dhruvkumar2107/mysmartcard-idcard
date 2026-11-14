import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { coursework, files, notices, students, submissions } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { storage } from "@/lib/storage";
import type { TenantContext } from "@/server/context";
import { getStudent } from "./students";
import { noticeViewer, noticeVisibleTo } from "./notices";
import { canViewTimetableFile } from "./timetable-images";
import { submissionsFor } from "./coursework";

type FileRow = typeof files.$inferSelect;

/** Whether `ctx` may download `file`. Authorization is decided per owner type — knowing a file id is never enough. */
export async function authorizeFile(ctx: TenantContext, file: FileRow): Promise<boolean> {
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

/** The stored bytes as a download response with safe headers. */
export async function fileResponse(req: Request, file: FileRow, opts: { publicCache?: boolean } = {}) {
  const body = await storage().get(file.storageKey);
  const download = new URL(req.url).searchParams.get("download") === "1";
  const inline = !download && (file.mimeType.startsWith("image/") || file.mimeType === "application/pdf");
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(body.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.originalName.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      "Cache-Control": opts.publicCache ? "public, max-age=3600" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
