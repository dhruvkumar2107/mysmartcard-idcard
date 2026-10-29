import { and, desc, eq, gt, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ref } from "@/db/sql";
import { getDb } from "@/db";
import { files, notices, notificationOutbox, students, type NoticeAudience } from "@/db/schema";
import { badRequest } from "@/lib/errors";
import { newStorageKey, storage, validateUpload } from "@/lib/storage";
import { audit } from "../audit";
import { assertAdminWrite, assertCan, type TenantContext } from "../context";
import { owned } from "./guard";

export const NOTICE_CATEGORIES = ["general", "department", "class", "exam", "holiday", "deadline", "event", "admin", "transport", "library"] as const;

const noticeInput = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(10_000),
  category: z.enum(NOTICE_CATEGORIES),
  pinned: z.boolean(),
  publishAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  publish: z.boolean(),
  notifyEmail: z.boolean(),
  audience: z.object({
    scope: z.enum(["all", "targeted"]),
    departmentIds: z.array(z.string().uuid()).default([]),
    programmeIds: z.array(z.string().uuid()).default([]),
    semesters: z.array(z.number().int().min(1).max(12)).default([]),
    sectionIds: z.array(z.string().uuid()).default([]),
    studentIds: z.array(z.string().uuid()).default([]),
  }),
});

/** HODs may only target their own department. */
function enforceAudienceScope(ctx: TenantContext, a: NoticeAudience): NoticeAudience {
  if (ctx.scope.kind !== "department") return a;
  return { ...a, scope: "targeted", departmentIds: ctx.departmentId ? [ctx.departmentId] : [] };
}

export async function createNotice(ctx: TenantContext, input: z.input<typeof noticeInput>, attachment?: File | null) {
  assertAdminWrite(ctx, "notices.publish");
  const d = noticeInput.parse(input);
  if (d.expiresAt && d.publishAt && d.expiresAt <= d.publishAt) throw badRequest("Expiry must be after the publish time.");
  const audience = enforceAudienceScope(ctx, d.audience);
  if (audience.scope === "targeted" && !audience.departmentIds?.length && !audience.programmeIds?.length && !audience.semesters?.length && !audience.sectionIds?.length && !audience.studentIds?.length)
    throw badRequest("Choose at least one audience filter, or publish to the whole college.");
  const upload = attachment && attachment.size > 0 ? await validateUpload(attachment, "document") : null;
  const db = getDb();
  const row = await db.transaction(async (tx) => {
    const [n] = await tx
      .insert(notices)
      .values({
        institutionId: ctx.institution.id,
        title: d.title,
        body: d.body,
        category: d.category,
        pinned: d.pinned,
        status: d.publish ? "published" : "draft",
        publishAt: d.publish ? (d.publishAt ?? new Date()) : d.publishAt,
        expiresAt: d.expiresAt,
        audience,
        notifyEmail: d.notifyEmail,
        createdByUserId: ctx.user.id,
      })
      .returning();
    if (upload) {
      const key = newStorageKey(ctx.institution.id, "notice");
      await storage().put(key, upload.buffer);
      await tx.insert(files).values({ institutionId: ctx.institution.id, ownerType: "notice", ownerId: n.id, storageKey: key, originalName: upload.name, mimeType: upload.mimeType, sizeBytes: upload.buffer.length, uploadedByUserId: ctx.user.id });
    }
    await audit(ctx, { action: d.publish ? "notice.publish" : "notice.draft", entityType: "notice", entityId: n.id, summary: `${d.publish ? "Published" : "Drafted"} notice "${n.title}"` }, tx);
    return n;
  });
  if (row.status === "published" && row.notifyEmail) await queueNoticeEmails(ctx, row);
  return row;
}

export async function setNoticeStatus(ctx: TenantContext, id: string, action: "publish" | "unpublish" | "pin" | "unpin" | "delete") {
  assertAdminWrite(ctx, "notices.publish");
  const n = await owned(ctx, notices, id, "Notice");
  if (ctx.scope.kind === "department" && n.createdByUserId !== ctx.user.id) throw badRequest("You can only manage notices you created.");
  const db = getDb();
  const where = and(eq(notices.id, n.id), eq(notices.institutionId, ctx.institution.id));
  if (action === "delete") await db.delete(notices).where(where);
  else
    await db
      .update(notices)
      .set(action === "publish" ? { status: "published", publishAt: n.publishAt ?? new Date() } : action === "unpublish" ? { status: "draft" } : { pinned: action === "pin" })
      .where(where);
  await audit(ctx, { action: `notice.${action}`, entityType: "notice", entityId: n.id, summary: `${action} notice "${n.title}"` });
  if (action === "publish" && n.notifyEmail) await queueNoticeEmails(ctx, n);
}

/**
 * Email delivery is an integration point: without EMAIL_PROVIDER configured,
 * messages are recorded with status `skipped_unconfigured` so nothing is
 * silently claimed as sent.
 */
async function queueNoticeEmails(ctx: TenantContext, n: typeof notices.$inferSelect) {
  const recipients = await audienceStudents(ctx, n.audience);
  const withEmail = recipients.filter((r) => r.email);
  if (!withEmail.length) return;
  const status = process.env.EMAIL_PROVIDER ? "queued" : "skipped_unconfigured";
  await getDb()
    .insert(notificationOutbox)
    .values(withEmail.slice(0, 5000).map((r) => ({ institutionId: ctx.institution.id, channel: "email", recipient: r.email!, subject: `[${ctx.institution.shortName}] ${n.title}`, body: n.body.slice(0, 5000), status })));
}

async function audienceStudents(ctx: TenantContext, a: NoticeAudience) {
  const conds: SQL[] = [eq(students.institutionId, ctx.institution.id), eq(students.status, "active")];
  if (a.scope === "targeted") {
    const ors: SQL[] = [];
    if (a.studentIds?.length) ors.push(inArray(students.id, a.studentIds));
    const and_: SQL[] = [];
    if (a.departmentIds?.length) and_.push(inArray(students.departmentId, a.departmentIds));
    if (a.programmeIds?.length) and_.push(inArray(students.programmeId, a.programmeIds));
    if (a.semesters?.length) and_.push(inArray(students.semester, a.semesters));
    if (a.sectionIds?.length) and_.push(inArray(students.sectionId, a.sectionIds));
    if (and_.length) ors.push(and(...and_)!);
    conds.push(or(...ors)!);
  }
  return getDb().select({ id: students.id, email: students.email }).from(students).where(and(...conds));
}

/** Pure audience match — also used by tests. Filters combine with AND; explicit student ids always match. */
export function noticeTargetsStudent(a: NoticeAudience, s: { id: string; departmentId: string | null; programmeId: string | null; semester: number; sectionId: string | null }) {
  if (a.scope === "all") return true;
  if (a.studentIds?.includes(s.id)) return true;
  const filters = [
    a.departmentIds?.length ? !!s.departmentId && a.departmentIds.includes(s.departmentId) : null,
    a.programmeIds?.length ? !!s.programmeId && a.programmeIds.includes(s.programmeId) : null,
    a.semesters?.length ? a.semesters.includes(s.semester) : null,
    a.sectionIds?.length ? !!s.sectionId && a.sectionIds.includes(s.sectionId) : null,
  ].filter((x): x is boolean => x !== null);
  return filters.length > 0 && filters.every(Boolean);
}

export async function adminNotices(ctx: TenantContext, q?: string) {
  assertCan(ctx, "notices.publish");
  const conds: SQL[] = [eq(notices.institutionId, ctx.institution.id)];
  if (q?.trim()) conds.push(ilike(notices.title, `%${q.trim().replace(/[%_]/g, "\\$&")}%`));
  if (ctx.scope.kind === "department") conds.push(eq(notices.createdByUserId, ctx.user.id));
  return getDb()
    .select({ notice: notices, attachments: sql<number>`(select count(*)::int from ${files} f where f.owner_type = 'notice' and f.owner_id = ${ref(notices.id)})` })
    .from(notices)
    .where(and(...conds))
    .orderBy(desc(notices.pinned), desc(notices.createdAt))
    .limit(200);
}

/** Currently-live notices (published, within publish/expiry window). */
function liveConditions(ctx: TenantContext): SQL[] {
  const now = new Date();
  return [eq(notices.institutionId, ctx.institution.id), eq(notices.status, "published"), or(isNull(notices.publishAt), lte(notices.publishAt, now))!, or(isNull(notices.expiresAt), gt(notices.expiresAt, now))!];
}

export async function noticesForStudent(ctx: TenantContext, s: Parameters<typeof noticeTargetsStudent>[1], q?: string) {
  const conds = liveConditions(ctx);
  if (q?.trim()) conds.push(or(ilike(notices.title, `%${q.trim()}%`), ilike(notices.body, `%${q.trim()}%`))!);
  const rows = await getDb().select().from(notices).where(and(...conds)).orderBy(desc(notices.pinned), desc(notices.publishAt)).limit(300);
  const visible = rows.filter((n) => noticeTargetsStudent(n.audience, s));
  const atts = visible.length
    ? await getDb()
        .select({ id: files.id, ownerId: files.ownerId, name: files.originalName, size: files.sizeBytes })
        .from(files)
        .where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "notice"), inArray(files.ownerId, visible.map((n) => n.id))))
    : [];
  return visible.map((n) => ({ ...n, attachments: atts.filter((a) => a.ownerId === n.id) }));
}

export async function recentLiveNotices(ctx: TenantContext, limit = 5) {
  return getDb().select().from(notices).where(and(...liveConditions(ctx))).orderBy(desc(notices.pinned), desc(notices.publishAt)).limit(limit);
}
