import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { ref } from "@/db/sql";
import { getDb } from "@/db";
import { coursework, files, programmes, sections, students, subjects, submissions } from "@/db/schema";
import { badRequest, forbidden } from "@/lib/errors";
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
  dueAt: z.date().nullable(),
  maxMarks: z.number().int().min(1).max(1000).nullable(),
  acceptSubmissions: z.boolean(),
});

export async function createCoursework(ctx: TenantContext, data: z.input<typeof input>, attachment?: File | null) {
  assertAdminWrite(ctx, "coursework.manage");
  const d = input.parse(data);
  const subj = await owned(ctx, subjects, d.subjectId, "Subject");
  const sec = await owned(ctx, sections, d.sectionId, "Section");
  if (!canManage(ctx, subj, sec.id)) throw forbidden("You can only publish coursework for classes you teach.");
  if (d.kind === "assignment" && !d.dueAt) throw badRequest("Assignments need a due date.");
  const upload = attachment && attachment.size > 0 ? await validateUpload(attachment, "document") : null;
  if (d.kind === "material" && !upload && !d.instructions) throw badRequest("Attach a file or add notes for study material.");
  const db = getDb();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(coursework)
      .values({ ...d, acceptSubmissions: d.kind === "assignment" && d.acceptSubmissions, institutionId: ctx.institution.id, createdByUserId: ctx.user.id })
      .returning();
    if (upload) {
      const key = newStorageKey(ctx.institution.id, "coursework");
      await storage().put(key, upload.buffer);
      await tx.insert(files).values({ institutionId: ctx.institution.id, ownerType: "coursework", ownerId: row.id, storageKey: key, originalName: upload.name, mimeType: upload.mimeType, sizeBytes: upload.buffer.length, uploadedByUserId: ctx.user.id });
    }
    await audit(ctx, { action: "coursework.create", entityType: "coursework", entityId: row.id, summary: `Published ${d.kind} "${row.title}" for ${subj.code}` }, tx);
    return row;
  });
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
    .select({ item: coursework, subjectCode: subjects.code, subjectName: subjects.name })
    .from(coursework)
    .innerJoin(subjects, eq(subjects.id, coursework.subjectId))
    .where(and(eq(coursework.institutionId, ctx.institution.id), eq(coursework.sectionId, student.sectionId)))
    .orderBy(desc(coursework.createdAt));
  if (!items.length) return [];
  const ids = items.map((i) => i.item.id);
  const [atts, subs] = await Promise.all([
    db.select({ id: files.id, ownerId: files.ownerId, name: files.originalName, size: files.sizeBytes }).from(files).where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "coursework"), inArray(files.ownerId, ids))),
    db.select().from(submissions).where(and(eq(submissions.studentId, student.id), inArray(submissions.courseworkId, ids))),
  ]);
  return items.map((i) => ({ ...i, attachments: atts.filter((a) => a.ownerId === i.item.id), submission: subs.find((s) => s.courseworkId === i.item.id) ?? null }));
}

export async function submitAssignment(ctx: TenantContext, courseworkId: string, file: File, note: string | null) {
  assertWritable(ctx);
  if (ctx.role !== "student" || !ctx.studentId) throw forbidden();
  const cw = await owned(ctx, coursework, courseworkId, "Assignment");
  const [me] = await getDb().select().from(students).where(and(eq(students.id, ctx.studentId), eq(students.institutionId, ctx.institution.id))).limit(1);
  if (!me || me.sectionId !== cw.sectionId) throw forbidden("This assignment is not for your class.");
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
