import { and, count, desc, eq, gt, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ref } from "@/db/sql";
import { getDb } from "@/db";
import { faculty, files, notices, noticeReads, notificationOutbox, students, users, type NoticeAudience } from "@/db/schema";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import type { Role } from "@/lib/permissions";
import { newStorageKey, storage, validateUpload } from "@/lib/storage";
import { audit } from "../audit";
import { assertAdminWrite, assertCan, type TenantContext } from "../context";
import { isUuid, owned } from "./guard";

export const NOTICE_CATEGORIES = ["general", "department", "class", "exam", "holiday", "deadline", "event", "admin", "transport", "library"] as const;
export const NOTICE_AUDIENCES = ["students", "teachers"] as const;
export type NoticeAudienceType = (typeof NOTICE_AUDIENCES)[number];
export const IMAGE_POSITIONS = ["top", "center", "bottom"] as const;

/** Staff roles that read the teacher notice board. College admins manage both boards instead. */
export const TEACHER_ROLES: Role[] = ["faculty", "hod", "principal"];
export const isTeacher = (ctx: Pick<TenantContext, "role">) => TEACHER_ROLES.includes(ctx.role);

const noticeInput = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(10_000),
  category: z.enum(NOTICE_CATEGORIES),
  pinned: z.boolean(),
  publishAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  publish: z.boolean(),
  notifyEmail: z.boolean(),
  audienceType: z.enum(NOTICE_AUDIENCES).default("students"),
  imagePosition: z.enum(IMAGE_POSITIONS).default("center"),
  audience: z.object({
    scope: z.enum(["all", "targeted"]),
    departmentIds: z.array(z.string().uuid()).default([]),
    programmeIds: z.array(z.string().uuid()).default([]),
    semesters: z.array(z.number().int().min(1).max(12)).default([]),
    sectionIds: z.array(z.string().uuid()).default([]),
    studentIds: z.array(z.string().uuid()).default([]),
  }),
});
export type NoticeInput = z.input<typeof noticeInput>;

/** HODs may only target their own department. Teacher notices can only target departments. */
function enforceAudienceScope(ctx: TenantContext, a: NoticeAudience, type: NoticeAudienceType): NoticeAudience {
  let out = a;
  if (type === "teachers") out = { scope: a.scope, departmentIds: a.departmentIds ?? [] };
  if (ctx.scope.kind !== "department") return out;
  return { ...out, scope: "targeted", departmentIds: ctx.departmentId ? [ctx.departmentId] : [] };
}

function validateAudience(a: NoticeAudience) {
  if (a.scope === "targeted" && !a.departmentIds?.length && !a.programmeIds?.length && !a.semesters?.length && !a.sectionIds?.length && !a.studentIds?.length)
    throw badRequest("Choose at least one audience filter, or publish to the whole college.");
}

async function storeNoticeFile(ctx: TenantContext, noticeId: string, upload: Awaited<ReturnType<typeof validateUpload>>, label: string | null) {
  const key = newStorageKey(ctx.institution.id, "notice");
  await storage().put(key, upload.buffer);
  const [f] = await getDb()
    .insert(files)
    .values({ institutionId: ctx.institution.id, ownerType: "notice", ownerId: noticeId, storageKey: key, originalName: upload.name, mimeType: upload.mimeType, sizeBytes: upload.buffer.length, label, uploadedByUserId: ctx.user.id })
    .returning();
  return f;
}

const hasFile = (f?: File | null): f is File => !!f && f.size > 0;

export async function createNotice(ctx: TenantContext, input: NoticeInput, attachment?: File | null, image?: File | null) {
  assertAdminWrite(ctx, "notices.publish");
  const d = noticeInput.parse(input);
  if (d.expiresAt && d.publishAt && d.expiresAt <= d.publishAt) throw badRequest("Expiry must be after the publish time.");
  const audience = enforceAudienceScope(ctx, d.audience, d.audienceType);
  validateAudience(audience);
  // Validate uploads before writing anything.
  const att = hasFile(attachment) ? await validateUpload(attachment, "document") : null;
  const img = hasFile(image) ? await validateUpload(image, "photo") : null;
  const [n] = await getDb()
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
      audienceType: d.audienceType,
      imagePosition: d.imagePosition,
      notifyEmail: d.notifyEmail,
      createdByUserId: ctx.user.id,
      updatedByUserId: ctx.user.id,
    })
    .returning();
  if (att) await storeNoticeFile(ctx, n.id, att, null);
  let row = n;
  if (img) {
    const f = await storeNoticeFile(ctx, n.id, img, "image");
    [row] = await getDb().update(notices).set({ imageFileId: f.id }).where(eq(notices.id, n.id)).returning();
  }
  await audit(ctx, { action: d.publish ? "notice.publish" : "notice.draft", entityType: "notice", entityId: n.id, summary: `${d.publish ? "Published" : "Drafted"} ${d.audienceType === "teachers" ? "teacher" : "student"} notice "${n.title}"` });
  if (row.status === "published" && row.notifyEmail && row.audienceType === "students") await queueNoticeEmails(ctx, row);
  return row;
}

/**
 * Edit a notice. Ordinary edits never re-notify anyone. A "major update" on a
 * published notice bumps its revision, so it shows as unread (once) for readers
 * who had read the earlier version.
 */
export async function updateNotice(ctx: TenantContext, id: string, input: NoticeInput & { majorUpdate?: boolean }, opts: { image?: File | null; removeImage?: boolean; attachment?: File | null } = {}) {
  assertAdminWrite(ctx, "notices.publish");
  const n = await manageable(ctx, id);
  const d = noticeInput.parse(input);
  if (d.expiresAt && d.publishAt && d.expiresAt <= d.publishAt) throw badRequest("Expiry must be after the publish time.");
  const audience = enforceAudienceScope(ctx, d.audience, d.audienceType);
  validateAudience(audience);
  const att = hasFile(opts.attachment) ? await validateUpload(opts.attachment, "document") : null;
  const img = hasFile(opts.image) ? await validateUpload(opts.image, "photo") : null;
  let imageFileId = n.imageFileId;
  if (img) imageFileId = (await storeNoticeFile(ctx, n.id, img, "image")).id;
  else if (opts.removeImage) imageFileId = null;
  if (att) await storeNoticeFile(ctx, n.id, att, null);
  const wasPublished = n.status === "published";
  const publish = d.publish;
  const bump = !!input.majorUpdate && wasPublished && publish;
  const [row] = await getDb()
    .update(notices)
    .set({
      title: d.title,
      body: d.body,
      category: d.category,
      pinned: d.pinned,
      status: publish ? "published" : "draft",
      publishAt: publish ? (d.publishAt ?? n.publishAt ?? new Date()) : d.publishAt,
      expiresAt: d.expiresAt,
      audience,
      audienceType: d.audienceType,
      imagePosition: d.imagePosition,
      imageFileId,
      notifyEmail: d.notifyEmail,
      revision: bump ? n.revision + 1 : n.revision,
      updatedByUserId: ctx.user.id,
      updatedAt: new Date(),
    })
    .where(and(eq(notices.id, n.id), eq(notices.institutionId, ctx.institution.id)))
    .returning();
  await audit(ctx, { action: bump ? "notice.major_update" : "notice.update", entityType: "notice", entityId: n.id, summary: `${bump ? "Major update to" : "Edited"} notice "${row.title}"` });
  return row;
}

async function manageable(ctx: TenantContext, id: string) {
  const n = await owned(ctx, notices, id, "Notice");
  if (ctx.scope.kind === "department" && n.createdByUserId !== ctx.user.id) throw badRequest("You can only manage notices you created.");
  return n;
}

export async function setNoticeStatus(ctx: TenantContext, id: string, action: "publish" | "unpublish" | "pin" | "unpin" | "archive" | "delete") {
  assertAdminWrite(ctx, "notices.publish");
  const n = await manageable(ctx, id);
  const db = getDb();
  const where = and(eq(notices.id, n.id), eq(notices.institutionId, ctx.institution.id));
  if (action === "delete") {
    const owned_ = await db.select().from(files).where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "notice"), eq(files.ownerId, n.id)));
    await db.delete(notices).where(where);
    await db.delete(files).where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "notice"), eq(files.ownerId, n.id)));
    await Promise.all(owned_.map((f) => storage().remove(f.storageKey)));
  } else {
    // Re-publishing keeps the same revision, so readers are not notified twice.
    const set =
      action === "publish"
        ? { status: "published", publishAt: n.publishAt ?? new Date() }
        : action === "unpublish"
          ? { status: "draft" }
          : action === "archive"
            ? { status: "archived", pinned: false }
            : { pinned: action === "pin" };
    await db.update(notices).set({ ...set, updatedByUserId: ctx.user.id, updatedAt: new Date() }).where(where);
  }
  await audit(ctx, { action: `notice.${action}`, entityType: "notice", entityId: n.id, summary: `${action} notice "${n.title}"` });
  if (action === "publish" && n.status !== "published" && n.notifyEmail && n.audienceType === "students") await queueNoticeEmails(ctx, n);
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

/** Teacher notices target the whole college or specific departments. */
export function noticeTargetsTeacher(a: NoticeAudience, departmentId: string | null) {
  if (a.scope === "all") return true;
  return !!departmentId && !!a.departmentIds?.includes(departmentId);
}

// ---------------------------------------------------------------- Admin side

export async function adminNotices(ctx: TenantContext, q?: string, opts: { audienceType?: NoticeAudienceType; status?: string } = {}) {
  assertCan(ctx, "notices.publish");
  const conds: SQL[] = [eq(notices.institutionId, ctx.institution.id)];
  if (q?.trim()) conds.push(ilike(notices.title, `%${q.trim().replace(/[%_]/g, "\\$&")}%`));
  if (opts.audienceType) conds.push(eq(notices.audienceType, opts.audienceType));
  if (opts.status === "archived") conds.push(eq(notices.status, "archived"));
  else if (opts.status) conds.push(eq(notices.status, opts.status));
  else if (opts.audienceType) conds.push(ne(notices.status, "archived"));
  if (ctx.scope.kind === "department") conds.push(eq(notices.createdByUserId, ctx.user.id));
  return getDb()
    .select({
      notice: notices,
      author: users.name,
      attachments: sql<number>`(select count(*)::int from ${files} f where f.owner_type = 'notice' and f.owner_id = ${ref(notices.id)} and f.label is distinct from 'image')`,
      reads: sql<number>`(select count(*)::int from ${noticeReads} r where r.notice_id = ${ref(notices.id)})`,
    })
    .from(notices)
    .leftJoin(users, eq(users.id, notices.createdByUserId))
    .where(and(...conds))
    .orderBy(desc(notices.pinned), desc(notices.createdAt))
    .limit(200);
}

export async function adminNotice(ctx: TenantContext, id: string) {
  assertCan(ctx, "notices.publish");
  const n = await manageable(ctx, id);
  const atts = await attachmentsFor(ctx, [n.id]);
  const [author] = n.createdByUserId ? await getDb().select({ name: users.name }).from(users).where(eq(users.id, n.createdByUserId)) : [];
  const [editor] = n.updatedByUserId ? await getDb().select({ name: users.name }).from(users).where(eq(users.id, n.updatedByUserId)) : [];
  return { notice: n, attachments: atts, author: author?.name ?? null, editor: editor?.name ?? null };
}

async function attachmentsFor(ctx: Pick<TenantContext, "institution">, ids: string[]) {
  if (!ids.length) return [];
  return getDb()
    .select({ id: files.id, ownerId: files.ownerId, name: files.originalName, size: files.sizeBytes, mimeType: files.mimeType })
    .from(files)
    .where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "notice"), inArray(files.ownerId, ids), or(isNull(files.label), ne(files.label, "image"))));
}

// ---------------------------------------------------------------- Readers (students & teachers)

/** Currently-live notices (published, within publish/expiry window). */
function liveConditions(ctx: Pick<TenantContext, "institution">): SQL[] {
  const now = new Date();
  return [eq(notices.institutionId, ctx.institution.id), eq(notices.status, "published"), or(isNull(notices.publishAt), lte(notices.publishAt, now))!, or(isNull(notices.expiresAt), gt(notices.expiresAt, now))!];
}

type StudentLike = Parameters<typeof noticeTargetsStudent>[1];
export type NoticeViewer = { kind: "student"; student: StudentLike } | { kind: "teacher"; departmentId: string | null };

/** Who is reading notices in this context, or null if the role has no notice board. */
export async function noticeViewer(ctx: TenantContext): Promise<NoticeViewer | null> {
  if (ctx.role === "student" && ctx.studentId) {
    const [s] = await getDb().select().from(students).where(and(eq(students.id, ctx.studentId), eq(students.institutionId, ctx.institution.id))).limit(1);
    return s ? { kind: "student", student: s } : null;
  }
  if (!isTeacher(ctx)) return null;
  let departmentId = ctx.departmentId;
  if (!departmentId && ctx.facultyId) {
    const [f] = await getDb().select({ departmentId: faculty.departmentId }).from(faculty).where(eq(faculty.id, ctx.facultyId));
    departmentId = f?.departmentId ?? null;
  }
  return { kind: "teacher", departmentId };
}

export function noticeVisibleTo(n: Pick<typeof notices.$inferSelect, "audience" | "audienceType">, v: NoticeViewer) {
  if (v.kind === "student") return n.audienceType === "students" && noticeTargetsStudent(n.audience, v.student);
  return n.audienceType === "teachers" && noticeTargetsTeacher(n.audience, v.departmentId);
}

async function liveFor(ctx: TenantContext, v: NoticeViewer, q?: string) {
  const conds = liveConditions(ctx);
  conds.push(eq(notices.audienceType, v.kind === "student" ? "students" : "teachers"));
  if (q?.trim()) {
    const like = `%${q.trim().replace(/[%_]/g, "\\$&")}%`;
    conds.push(or(ilike(notices.title, like), ilike(notices.body, like))!);
  }
  const rows = await getDb().select().from(notices).where(and(...conds)).orderBy(desc(notices.pinned), desc(notices.publishAt)).limit(300);
  return rows.filter((n) => noticeVisibleTo(n, v));
}

async function readMap(ctx: TenantContext, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await getDb().select({ noticeId: noticeReads.noticeId, revision: noticeReads.revision }).from(noticeReads).where(and(eq(noticeReads.userId, ctx.user.id), inArray(noticeReads.noticeId, ids)));
  return new Map(rows.map((r) => [r.noticeId, r.revision]));
}

const isUnread = (n: { id: string; revision: number }, reads: Map<string, number>) => (reads.get(n.id) ?? 0) < n.revision;

/** Notices for a student, with attachments. Kept for existing callers. */
export async function noticesForStudent(ctx: TenantContext, s: StudentLike, q?: string) {
  const visible = await liveFor(ctx, { kind: "student", student: s }, q);
  const atts = await attachmentsFor(ctx, visible.map((n) => n.id));
  return visible.map((n) => ({ ...n, attachments: atts.filter((a) => a.ownerId === n.id) }));
}

/** Paginated feed with per-user unread flags. */
export async function noticeFeed(ctx: TenantContext, v: NoticeViewer, opts: { q?: string; page?: number; pageSize?: number } = {}) {
  const all = await liveFor(ctx, v, opts.q);
  const reads = await readMap(ctx, all.map((n) => n.id));
  const pageSize = opts.pageSize ?? 10;
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  const slice = all.slice((page - 1) * pageSize, page * pageSize);
  const atts = await attachmentsFor(ctx, slice.map((n) => n.id));
  return {
    items: slice.map((n) => ({ ...n, unread: isUnread(n, reads), attachments: atts.filter((a) => a.ownerId === n.id) })),
    total: all.length,
    unread: all.filter((n) => isUnread(n, reads)).length,
    page,
    pages,
  };
}

/** Bell data: unread count plus the most recent notices. */
export async function notificationSummary(ctx: TenantContext, v: NoticeViewer, limit = 8) {
  const all = await liveFor(ctx, v);
  const reads = await readMap(ctx, all.map((n) => n.id));
  const recent = [...all].sort((a, b) => (b.publishAt?.getTime() ?? 0) - (a.publishAt?.getTime() ?? 0)).slice(0, limit);
  return {
    unread: all.filter((n) => isUnread(n, reads)).length,
    items: recent.map((n) => ({ id: n.id, title: n.title, category: n.category, publishAt: n.publishAt, unread: isUnread(n, reads), hasImage: !!n.imageFileId })),
  };
}

/** One live notice the viewer is allowed to read (404 otherwise — no existence oracle). */
export async function noticeForViewer(ctx: TenantContext, v: NoticeViewer, id: string) {
  if (!isUuid(id)) throw notFound("Notice");
  const [n] = await getDb()
    .select()
    .from(notices)
    .where(and(eq(notices.id, id), ...liveConditions(ctx)))
    .limit(1);
  if (!n || !noticeVisibleTo(n, v)) throw notFound("Notice");
  const [atts, reads] = await Promise.all([attachmentsFor(ctx, [n.id]), readMap(ctx, [n.id])]);
  return { ...n, attachments: atts, unread: isUnread(n, reads) };
}

/** Mark exactly one notice as read for the signed-in user. Idempotent. */
export async function markNoticeRead(ctx: TenantContext, v: NoticeViewer, id: string) {
  if (ctx.viaPlatform || ctx.viaSupport) throw forbidden();
  const n = await noticeForViewer(ctx, v, id);
  await getDb()
    .insert(noticeReads)
    .values({ institutionId: ctx.institution.id, noticeId: n.id, userId: ctx.user.id, revision: n.revision })
    .onConflictDoUpdate({ target: [noticeReads.noticeId, noticeReads.userId], set: { revision: n.revision, readAt: new Date() } });
}

export async function recentLiveNotices(ctx: TenantContext, limit = 5) {
  return getDb().select().from(notices).where(and(...liveConditions(ctx))).orderBy(desc(notices.pinned), desc(notices.publishAt)).limit(limit);
}

export async function noticeCounts(ctx: TenantContext) {
  assertCan(ctx, "notices.publish");
  const rows = await getDb()
    .select({ type: notices.audienceType, status: notices.status, n: count() })
    .from(notices)
    .where(eq(notices.institutionId, ctx.institution.id))
    .groupBy(notices.audienceType, notices.status);
  const get = (type: string, status?: string) => rows.filter((r) => r.type === type && (!status || r.status === status)).reduce((s, r) => s + Number(r.n), 0);
  return { students: get("students") - get("students", "archived"), teachers: get("teachers") - get("teachers", "archived") };
}