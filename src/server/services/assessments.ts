import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ref } from "@/db/sql";
import { getDb } from "@/db";
import { assessments, marks, programmes, sections, subjects, students } from "@/db/schema";
import { ASSESSMENT_CATEGORIES, canTransition, computeSubjectResults, semesterSummary, type AssessmentStatus } from "@/lib/academics";
import { badRequest, forbidden } from "@/lib/errors";
import { audit } from "../audit";
import { assertAdminWrite, assertCan, assertWritable, type TenantContext } from "../context";
import { owned } from "./guard";
import { rosterForSection } from "./attendance";

const CATEGORY_KEYS = ASSESSMENT_CATEGORIES.map((c) => c.key) as [string, ...string[]];

/** Faculty: own classes. HOD: department. Principal/admin: all. */
function canManageAssessment(ctx: TenantContext, subj: { id: string; departmentId: string }, sectionId: string) {
  if (ctx.role === "college_admin" || ctx.role === "principal") return true;
  if (ctx.classes.some((c) => c.subjectId === subj.id && c.sectionId === sectionId)) return true;
  return ctx.scope.kind === "department" && subj.departmentId === ctx.departmentId;
}

async function loadAssessment(ctx: TenantContext, id: string) {
  const a = await owned(ctx, assessments, id, "Assessment");
  const subj = await owned(ctx, subjects, a.subjectId, "Subject");
  return { a, subj };
}

export async function listAssessments(ctx: TenantContext, filter: { status?: string } = {}) {
  const conds: SQL[] = [eq(assessments.institutionId, ctx.institution.id)];
  if (filter.status) conds.push(eq(assessments.status, filter.status));
  const rows = await getDb()
    .select({
      assessment: assessments,
      subjectCode: subjects.code,
      subjectName: subjects.name,
      departmentId: subjects.departmentId,
      semester: sections.semester,
      sectionName: sections.name,
      programmeCode: programmes.code,
      entered: sql<number>`(select count(*)::int from ${marks} m where m.assessment_id = ${ref(assessments.id)})`,
      roster: sql<number>`(select count(*)::int from ${students} s where s.section_id = ${ref(assessments.sectionId)} and s.status = 'active')`,
    })
    .from(assessments)
    .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
    .innerJoin(sections, eq(sections.id, assessments.sectionId))
    .innerJoin(programmes, eq(programmes.id, sections.programmeId))
    .where(and(...conds))
    .orderBy(desc(assessments.createdAt));
  return rows.filter((r) => canManageAssessment(ctx, { id: r.assessment.subjectId, departmentId: r.departmentId }, r.assessment.sectionId));
}

const assessmentInput = z.object({
  subjectId: z.string(),
  sectionId: z.string(),
  name: z.string().trim().min(2).max(120),
  category: z.enum(CATEGORY_KEYS),
  maxMarks: z.number().positive().max(1000),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  room: z.string().max(40).nullable(),
});

export async function createAssessment(ctx: TenantContext, input: z.input<typeof assessmentInput>) {
  assertAdminWrite(ctx, "assessments.manage");
  const d = assessmentInput.parse(input);
  const subj = await owned(ctx, subjects, d.subjectId, "Subject");
  const sec = await owned(ctx, sections, d.sectionId, "Section");
  if (!canManageAssessment(ctx, subj, sec.id)) throw forbidden("You can only create assessments for classes you teach.");
  const [row] = await getDb().insert(assessments).values({ ...d, institutionId: ctx.institution.id, createdByUserId: ctx.user.id }).returning();
  await audit(ctx, { action: "assessment.create", entityType: "assessment", entityId: row.id, summary: `Created ${row.category} "${row.name}" for ${subj.code}` });
  return row;
}

export async function marksSheet(ctx: TenantContext, id: string) {
  const { a, subj } = await loadAssessment(ctx, id);
  if (!canManageAssessment(ctx, subj, a.sectionId) && !ctx.perms.has("results.approve")) throw forbidden();
  const roster = await rosterForSection(ctx, a.sectionId);
  const existing = await getDb().select().from(marks).where(eq(marks.assessmentId, a.id));
  const by = new Map(existing.map((m) => [m.studentId, m]));
  return { assessment: a, subject: subj, rows: roster.map((s) => ({ ...s, mark: by.get(s.id) ?? null })) };
}

export async function enterMarks(ctx: TenantContext, id: string, entries: { studentId: string; value: string }[]) {
  assertAdminWrite(ctx, "marks.enter");
  const { a, subj } = await loadAssessment(ctx, id);
  if (!canManageAssessment(ctx, subj, a.sectionId)) throw forbidden("You can only enter marks for classes you teach.");
  if (a.status !== "draft") throw badRequest("Marks are locked. Ask an approver to reopen this assessment for correction.");
  const roster = new Set((await rosterForSection(ctx, a.sectionId)).map((r) => r.id));
  const values = [];
  for (const e of entries) {
    if (!roster.has(e.studentId)) throw badRequest("A student in the submission is not in this section.");
    const v = e.value.trim().toUpperCase();
    if (v === "") continue;
    if (v === "AB") {
      values.push({ institutionId: ctx.institution.id, assessmentId: a.id, studentId: e.studentId, marksObtained: null, isAbsent: true, enteredByUserId: ctx.user.id });
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > a.maxMarks) throw badRequest(`Marks must be between 0 and ${a.maxMarks} (or AB for absent).`);
    values.push({ institutionId: ctx.institution.id, assessmentId: a.id, studentId: e.studentId, marksObtained: Math.round(n * 100) / 100, isAbsent: false, enteredByUserId: ctx.user.id });
  }
  if (!values.length) throw badRequest("Enter at least one mark.");
  await getDb()
    .insert(marks)
    .values(values)
    .onConflictDoUpdate({
      target: [marks.assessmentId, marks.studentId],
      set: { marksObtained: sql`excluded.marks_obtained`, isAbsent: sql`excluded.is_absent`, enteredByUserId: ctx.user.id, updatedAt: new Date() },
    });
  await audit(ctx, { action: "marks.enter", entityType: "assessment", entityId: a.id, summary: `Entered ${values.length} mark(s) for "${a.name}" (${subj.code})` });
}

/**
 * Workflow: draft → submitted (by teacher) → approved (HOD/principal) → published (principal/admin).
 * Any state → draft is a "reopen for correction" and requires results.publish (except submitted→draft by the author).
 */
export async function transitionAssessment(ctx: TenantContext, id: string, to: AssessmentStatus, reason?: string) {
  assertWritable(ctx);
  const { a, subj } = await loadAssessment(ctx, id);
  const from = a.status as AssessmentStatus;
  if (!canTransition(from, to)) throw badRequest(`Cannot move from ${from} to ${to}.`);
  if (to === "submitted") {
    assertCan(ctx, "marks.enter");
    if (!canManageAssessment(ctx, subj, a.sectionId)) throw forbidden();
    const roster = await rosterForSection(ctx, a.sectionId);
    const [{ n }] = await getDb().select({ n: sql<number>`count(*)::int` }).from(marks).where(eq(marks.assessmentId, a.id));
    if (n < roster.length) throw badRequest(`Marks missing for ${roster.length - n} student(s). Enter AB for absentees.`);
  }
  if (to === "approved") {
    assertCan(ctx, "results.approve");
    if (ctx.scope.kind === "department" && subj.departmentId !== ctx.departmentId) throw forbidden("Outside your department.");
    if (a.createdByUserId === ctx.user.id && ctx.role !== "college_admin") throw forbidden("Marks must be approved by someone other than the author.");
  }
  if (to === "published") assertCan(ctx, "results.publish");
  if (to === "draft") {
    const authorWithdraw = from === "submitted" && canManageAssessment(ctx, subj, a.sectionId);
    if (!authorWithdraw) assertCan(ctx, "results.publish");
    if (from === "published" && !reason?.trim()) throw badRequest("A reason is required to reopen published results.");
  }
  await getDb()
    .update(assessments)
    .set({
      status: to,
      approvedByUserId: to === "approved" ? ctx.user.id : to === "draft" ? null : a.approvedByUserId,
      publishedAt: to === "published" ? new Date() : to === "draft" ? null : a.publishedAt,
    })
    .where(and(eq(assessments.id, a.id), eq(assessments.institutionId, ctx.institution.id)));
  await audit(ctx, { action: `assessment.${to === "draft" ? "reopen" : to}`, entityType: "assessment", entityId: a.id, summary: `"${a.name}" (${subj.code}): ${from} → ${to}${reason ? ` — ${reason}` : ""}` });
}

/** Published results only. Unpublished marks never leave the server for students. */
export async function publishedResultsForStudent(ctx: TenantContext, studentId: string) {
  const rows = await getDb()
    .select({
      assessmentId: assessments.id,
      name: assessments.name,
      category: assessments.category,
      maxMarks: assessments.maxMarks,
      examDate: assessments.examDate,
      publishedAt: assessments.publishedAt,
      subjectId: subjects.id,
      subjectCode: subjects.code,
      subjectName: subjects.name,
      credits: subjects.credits,
      semester: subjects.semester,
      obtained: marks.marksObtained,
      isAbsent: marks.isAbsent,
    })
    .from(marks)
    .innerJoin(assessments, eq(assessments.id, marks.assessmentId))
    .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
    .where(and(eq(marks.institutionId, ctx.institution.id), eq(marks.studentId, studentId), eq(assessments.status, "published")))
    .orderBy(asc(subjects.semester), asc(subjects.code), asc(assessments.examDate));

  const subjectMap = new Map(rows.map((r) => [r.subjectId, { id: r.subjectId, code: r.subjectCode, name: r.subjectName, credits: r.credits, semester: r.semester }]));
  const results = computeSubjectResults(
    rows.map((r) => ({ subjectId: r.subjectId, obtained: r.obtained, max: r.maxMarks, isAbsent: r.isAbsent })),
    [...subjectMap.values()],
    ctx.academic,
  );
  return { assessments: rows, ...semesterSummary(results) };
}

export async function examSchedule(ctx: TenantContext, sectionIds: string[]) {
  if (!sectionIds.length) return [];
  return getDb()
    .select({ assessment: assessments, subjectCode: subjects.code, subjectName: subjects.name })
    .from(assessments)
    .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
    .where(and(eq(assessments.institutionId, ctx.institution.id), inArray(assessments.sectionId, sectionIds), sql`${assessments.examDate} >= current_date`, inArray(assessments.category, ["internal", "midterm", "end_semester", "practical", "viva"])))
    .orderBy(asc(assessments.examDate), asc(assessments.startTime));
}

export async function upcomingExams(ctx: TenantContext, limit = 6) {
  return getDb()
    .select({ assessment: assessments, subjectCode: subjects.code, semester: sections.semester, sectionName: sections.name, programmeCode: programmes.code })
    .from(assessments)
    .innerJoin(subjects, eq(subjects.id, assessments.subjectId))
    .innerJoin(sections, eq(sections.id, assessments.sectionId))
    .innerJoin(programmes, eq(programmes.id, sections.programmeId))
    .where(and(eq(assessments.institutionId, ctx.institution.id), sql`${assessments.examDate} >= current_date`))
    .orderBy(asc(assessments.examDate))
    .limit(limit);
}
