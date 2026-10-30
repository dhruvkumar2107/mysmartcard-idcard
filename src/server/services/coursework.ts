import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { ref } from "@/db/sql";
import { getDb, type Executor } from "@/db";
import { coursework, files, programmes, sections, students, subjects, submissions, users } from "@/db/schema";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { newStorageKey, storage, validateUpload } from "@/lib/storage";
import { audit } from "../audit";
import { assertAdminWrite, assertWritable, type TenantContext } from "../context";
import { owned } from "./guard";

function canManage(ctx: TenantContext, subj: { id: string; departmentId: string }, sectionId: string) {
  if (ctx.role === "college_admin") return true;
  if (ctx.classes.some((c) => c.subjectId === subj.id && c.sectionId === sectionId)) return true;
  return ctx.scope.kind === "department" && subj.departmentId === ctx.departmentId;
}

const input = z.object({
  subjectId: z.string(),
  sectionId: z.string(),
  kind: z.enum(["assignment", "material"]),
  title: z.string().trim().min(2).max(200),
  instructions: z.string().max(5000).nullable(),
  /** Optional admin record. Students only see it if the super admin enables assignment deadlines. */
  dueAt: z.date().nullable(),
  maxMarks: z.number().int().min(1).max(1000).nullable(),
  acceptSubmissions: z.boolean(),
  status: z.enum(["draft", "published"]).default("published"),
});
export type CourseworkInput = z.input<typeof input>;

const MAX_IMAGES = 12;

async function storeCourseworkFile(ctx: TenantContext, courseworkId: string, up: Awaited<ReturnType<typeof validateUpload>>, tx: Executor = getDb()) {
  const key = newStorageKey(ctx.institution.id, "coursework");
  await storage().put(key, up.buffer);
  await tx.insert(files).values({ institutionId: ctx.institution.id, ownerType: "coursework", ownerId: courseworkId, storageKey: key, originalName: up.name, mimeType: up.mimeType, sizeBytes: up.buffer.length, uploadedByUserId: ctx.user.id });
}

const realFiles = (fs?: (File | null)[] | null) => (fs ?? []).filter((f): f is File => !!f && f.size > 0);

export async function createCoursework(ctx: TenantContext, data: CourseworkInput, attachment?: File | null, images?: File[]) {
  assertAdminWrite(ctx, "coursework.manage");
  const d = input.parse(data);
  const subj = await owned(ctx, subjects, d.subjectId, "Subject");
  const sec = await owned(ctx, sections, d.sectionId, "Section");
  if (!canManage(ctx, subj, sec.id)) throw forbidden("You can only publish coursework for classes you teach.");
  const imgs = realFiles(images);
  if (imgs.length > MAX_IMAGES) throw badRequest(`Upload at most ${MAX_IMAGES} images per assignment.`);
  // Validate every upload before writing anything.
  const imageUploads = await Promise.all(imgs.map((f) => validateUpload(f, "photo")));
  const upload = attachment && attachment.size > 0 ? await validateUpload(attachment, "document") : null;
  if (!upload && !imageUploads.length && !d.instructions) throw badRequest(d.kind === "assignment" ? "Add at least one assignment image." : "Attach a file or add notes for study material.");
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(coursework)
      .values({ ...d, acceptSubmissions: d.kind === "assignment" && d.acceptSubmissions, institutionId: ctx.institution.id, createdByUserId: ctx.user.id })
      .returning();
    for (const up of [...imageUploads, ...(upload ? [upload] : [])]) await storeCourseworkFile(ctx, row.id, up, tx);
    await audit(ctx, { action: d.status === "published" ? "coursework.create" : "coursework.draft", entityType: "coursework", entityId: row.id, summary: `${d.status === "published" ? "Published" : "Drafted"} ${d.kind} "${row.title}" for ${subj.code}${imageUploads.length ? ` with ${imageUploads.length} image(s)` : ""}` }, tx);
    return row;
  });
}

async function manageableCoursework(ctx: TenantContext, id: string) {
  const cw = await owned(ctx, coursework, id, "Assignment");
  const subj = await owned(ctx, subjects, cw.subjectId, "Subject");
  if (!canManage(ctx, subj, cw.sectionId)) throw forbidden();
  return { cw, subj };
}

export async function updateCoursework(ctx: TenantContext, id: string, data: { title: string; instructions: string | null; dueAt: Date | null; maxMarks: number | null }) {
  assertAdminWrite(ctx, "coursework.manage");
  const { cw } = await manageableCoursework(ctx, id);
  const d = input.pick({ title: true, instructions: true, dueAt: true, maxMarks: true }).parse(data);
  await getDb().update(coursework).set({ ...d, updatedAt: new Date() }).where(and(eq(coursework.id, cw.id), eq(coursework.institutionId, ctx.institution.id)));
  await audit(ctx, { action: "coursework.update", entityType: "coursework", entityId: cw.id, summary: `Edited "${d.title}"` });
}

export async function addCourseworkImages(ctx: TenantContext, id: string, images: File[]) {
  assertAdminWrite(ctx, "coursework.manage");
  const { cw } = await manageableCoursework(ctx, id);
  const imgs = realFiles(images);
  if (!imgs.length) throw badRequest("Choose at least one image.");
  const [{ n }] = await getDb().select({ n: sql<number>`count(*)::int` }).from(files).where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "coursework"), eq(files.ownerId, cw.id)));
  if (n + imgs.length > MAX_IMAGES) throw badRequest(`An assignment can have at most ${MAX_IMAGES} files.`);
  const ups = await Promise.all(imgs.map((f) => validateUpload(f, "photo")));
  for (const up of ups) await storeCourseworkFile(ctx, cw.id, up);
  await getDb().update(coursework).set({ updatedAt: new Date() }).where(eq(coursework.id, cw.id));
  await audit(ctx, { action: "coursework.images_add", entityType: "coursework", entityId: cw.id, summary: `Added ${ups.length} image(s) to "${cw.title}"` });
}

export async function removeCourseworkFile(ctx: TenantContext, id: string, fileId: string) {
  assertAdminWrite(ctx, "coursework.manage");
  const { cw } = await manageableCoursework(ctx, id);
  const f = await owned(ctx, files, fileId, "File");
  if (f.ownerType !== "coursework" || f.ownerId !== cw.id) throw notFound("File");
  await getDb().delete(files).where(eq(files.id, f.id));
  await storage().remove(f.storageKey);
  await audit(ctx, { action: "coursework.file_remove", entityType: "coursework", entityId: cw.id, summary: `Removed ${f.originalName} from "${cw.title}"` });
}

export async function setCourseworkStatus(ctx: TenantContext, id: string, action: "publish" | "unpublish" | "archive" | "delete") {
  assertAdminWrite(ctx, "coursework.manage");
  const { cw } = await manageableCoursework(ctx, id);
  const where = and(eq(coursework.id, cw.id), eq(coursework.institutionId, ctx.institution.id));
  if (action === "delete") {
    // Submitted work is part of the academic record: archive instead of deleting.
    const [{ n }] = await getDb().select({ n: sql<number>`count(*)::int` }).from(submissions).where(eq(submissions.courseworkId, cw.id));
    if (n > 0) throw badRequest("Students have submitted work for this assignment. Archive it instead of deleting.");
    const own = await getDb().select().from(files).where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "coursework"), eq(files.ownerId, cw.id)));
    await getDb().delete(coursework).where(where);
    await getDb().delete(files).where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "coursework"), eq(files.ownerId, cw.id)));
    await Promise.all(own.map((f) => storage().remove(f.storageKey)));
  } else {
    const status = action === "publish" ? "published" : action === "archive" ? "archived" : "draft";
    await getDb().update(coursework).set({ status, updatedAt: new Date() }).where(where);
  }
  await audit(ctx, { action: `coursework.${action}`, entityType: "coursework", entityId: cw.id, summary: `${action} "${cw.title}"` });
}

/** Admin detail: the item, its class, files and who published it. */
export async function courseworkDetail(ctx: TenantContext, id: string) {
  const { cw, subj } = await manageableCoursework(ctx, id);
  const [[sec], attachments, [author]] = await Promise.all([
    getDb().select({ semester: sections.semester, name: sections.name, programmeCode: programmes.code }).from(sections).innerJoin(programmes, eq(programmes.id, sections.programmeId)).where(eq(sections.id, cw.sectionId)),
    getDb().select().from(files).where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "coursework"), eq(files.ownerId, cw.id))).orderBy(asc(files.createdAt)),
    cw.createdByUserId ? getDb().select({ name: users.name }).from(users).where(eq(users.id, cw.createdByUserId)) : Promise.resolve([] as { name: string }[]),
  ]);
  return { coursework: cw, subject: subj, section: sec, attachments, author: author?.name ?? null };
}

export async function listCourseworkForStaff(ctx: TenantContext) {
  const rows = await getDb()
    .select({
      item: coursework,
      subjectCode: subjects.code,
      departmentId: subjects.departmentId,
      semester: sections.semester,
      sectionName: sections.name,
      programmeCode: programmes.code,
      submissions: sql<number>`(select count(*)::int from ${submissions} s where s.coursework_id = ${ref(coursework.id)})`,
      attachments: sql<number>`(select count(*)::int from ${files} f where f.owner_type = 'coursework' and f.owner_id = ${ref(coursework.id)})`,
      images: sql<number>`(select count(*)::int from ${files} f where f.owner_type = 'coursework' and f.owner_id = ${ref(coursework.id)} and f.mime_type like 'image/%')`,
      cover: sql<string | null>`(select f.id from ${files} f where f.owner_type = 'coursework' and f.owner_id = ${ref(coursework.id)} and f.mime_type like 'image/%' order by f.created_at limit 1)`,
    })
    .from(coursework)
    .innerJoin(subjects, eq(subjects.id, coursework.subjectId))
    .innerJoin(sections, eq(sections.id, coursework.sectionId))
    .innerJoin(programmes, eq(programmes.id, sections.programmeId))
    .where(eq(coursework.institutionId, ctx.institution.id))
    .orderBy(desc(coursework.createdAt));
  return rows.filter((r) => canManage(ctx, { id: r.item.subjectId, departmentId: r.departmentId }, r.item.sectionId));
}

export async function submissionsFor(ctx: TenantContext, courseworkId: string) {
  const cw = await owned(ctx, coursework, courseworkId, "Assignment");
  const subj = await owned(ctx, subjects, cw.subjectId, "Subject");
  if (!canManage(ctx, subj, cw.sectionId)) throw forbidden();
  const roster = await getDb()
    .select({ id: students.id, enrollmentNo: students.enrollmentNo, fullName: students.fullName })
    .from(students)
    .where(and(eq(students.institutionId, ctx.institution.id), eq(students.sectionId, cw.sectionId), eq(students.status, "active")))
    .orderBy(students.enrollmentNo);
  const subs = await getDb().select().from(submissions).where(eq(submissions.courseworkId, cw.id));
  const by = new Map(subs.map((s) => [s.studentId, s]));
  return { coursework: cw, subject: subj, rows: roster.map((r) => ({ ...r, submission: by.get(r.id) ?? null })) };
}

export async function gradeSubmission(ctx: TenantContext, submissionId: string, grade: number | null, feedback: string | null) {
  assertAdminWrite(ctx, "coursework.manage");
  const sub = await owned(ctx, submissions, submissionId, "Submission");
  const cw = await owned(ctx, coursework, sub.courseworkId, "Assignment");
  const subj = await owned(ctx, subjects, cw.subjectId, "Subject");
  if (!canManage(ctx, subj, cw.sectionId)) throw forbidden();
  if (grade !== null && (grade < 0 || (cw.maxMarks !== null && grade > cw.maxMarks))) throw badRequest(`Grade must be between 0 and ${cw.maxMarks}.`);
  await getDb().update(submissions).set({ grade, feedback: feedback?.slice(0, 2000) ?? null, gradedByUserId: ctx.user.id }).where(eq(submissions.id, sub.id));
  await audit(ctx, { action: "coursework.grade", entityType: "submission", entityId: sub.id, summary: `Graded submission for "${cw.title}": ${grade ?? "—"}` });
}

// ---------------------------------------------------------------- Student side

export async function courseworkForStudent(ctx: TenantContext, student: { id: string; sectionId: string | null }) {
  if (!student.sectionId) return [];
  const db = getDb();
  const items = await db
    .select({ item: coursework, subjectCode: subjects.code, subjectName: subjects.name, publisher: users.name })
    .from(coursework)
    .innerJoin(subjects, eq(subjects.id, coursework.subjectId))
    .leftJoin(users, eq(users.id, coursework.createdByUserId))
    .where(and(eq(coursework.institutionId, ctx.institution.id), eq(coursework.sectionId, student.sectionId), eq(coursework.status, "published")))
    .orderBy(desc(coursework.createdAt));
  if (!items.length) return [];
  const ids = items.map((i) => i.item.id);
  const [atts, subs] = await Promise.all([
    db.select({ id: files.id, ownerId: files.ownerId, name: files.originalName, size: files.sizeBytes, mimeType: files.mimeType }).from(files).where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "coursework"), inArray(files.ownerId, ids))).orderBy(asc(files.createdAt)),
    db.select().from(submissions).where(and(eq(submissions.studentId, student.id), inArray(submissions.courseworkId, ids))),
  ]);
  return items.map((i) => ({ ...i, attachments: atts.filter((a) => a.ownerId === i.item.id), submission: subs.find((s) => s.courseworkId === i.item.id) ?? null }));
}

export async function submitAssignment(ctx: TenantContext, courseworkId: string, file: File, note: string | null) {
  assertWritable(ctx);
  if (ctx.role !== "student" || !ctx.studentId) throw forbidden();
  const cw = await owned(ctx, coursework, courseworkId, "Assignment");
  const [me] = await getDb().select().from(students).where(and(eq(students.id, ctx.studentId), eq(students.institutionId, ctx.institution.id))).limit(1);
  if (!me || me.sectionId !== cw.sectionId || cw.status !== "published") throw forbidden("This assignment is not for your class.");
  if (!cw.acceptSubmissions) throw badRequest("This assignment does not accept online submissions.");
  if (cw.dueAt && cw.dueAt < new Date()) throw badRequest("The submission deadline has passed.");
  const [existing] = await getDb().select().from(submissions).where(and(eq(submissions.courseworkId, cw.id), eq(submissions.studentId, me.id))).limit(1);
  if (existing?.grade != null) throw badRequest("This submission has already been graded.");
  const upload = await validateUpload(file, "document");
  const key = newStorageKey(ctx.institution.id, "submission");
  await storage().put(key, upload.buffer);
  const db = getDb();
  await db.transaction(async (tx) => {
    const [f] = await tx
      .insert(files)
      .values({ institutionId: ctx.institution.id, ownerType: "submission", ownerId: cw.id, storageKey: key, originalName: upload.name, mimeType: upload.mimeType, sizeBytes: upload.buffer.length, uploadedByUserId: ctx.user.id })
      .returning();
    await tx
      .insert(submissions)
      .values({ institutionId: ctx.institution.id, courseworkId: cw.id, studentId: me.id, fileId: f.id, note: note?.slice(0, 1000) ?? null })
      .onConflictDoUpdate({ target: [submissions.courseworkId, submissions.studentId], set: { fileId: f.id, note: note?.slice(0, 1000) ?? null, submittedAt: new Date() } });
    await audit(ctx, { action: "coursework.submit", entityType: "coursework", entityId: cw.id, summary: `${me.enrollmentNo} submitted "${cw.title}"` }, tx);
  });
}
