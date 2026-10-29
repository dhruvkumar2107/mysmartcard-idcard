import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { ref } from "@/db/sql";
import { getDb } from "@/db";
import { attendanceCorrections, attendanceRecords, attendanceSessions, classAssignments, students, subjects, users } from "@/db/schema";
import { ATTENDANCE_STATUSES, summarizeAttendance, type AttendanceStatus } from "@/lib/academics";
import { badRequest, forbidden } from "@/lib/errors";
import { audit } from "../audit";
import { assertAdminWrite, assertCan, assertWritable, type TenantContext } from "../context";
import { owned } from "./guard";

/** May the caller act on this class? Own class, or department/all scope with view_all. */
export function canActOnClass(ctx: TenantContext, ca: { id: string; subjectDepartmentId?: string | null }) {
  if (ctx.classes.some((c) => c.id === ca.id)) return true;
  if (ctx.role === "college_admin" || ctx.role === "principal") return true;
  if (ctx.scope.kind === "department" && ca.subjectDepartmentId && ca.subjectDepartmentId === ctx.departmentId) return true;
  return false;
}

async function loadClass(ctx: TenantContext, classAssignmentId: string) {
  const ca = await owned(ctx, classAssignments, classAssignmentId, "Class");
  const subj = await owned(ctx, subjects, ca.subjectId, "Subject");
  if (!canActOnClass(ctx, { id: ca.id, subjectDepartmentId: subj.departmentId })) throw forbidden("You are not assigned to this class.");
  return { ca, subj };
}

export async function rosterForSection(ctx: TenantContext, sectionId: string) {
  return getDb()
    .select({ id: students.id, enrollmentNo: students.enrollmentNo, fullName: students.fullName })
    .from(students)
    .where(and(eq(students.institutionId, ctx.institution.id), eq(students.sectionId, sectionId), eq(students.status, "active")))
    .orderBy(asc(students.enrollmentNo));
}

/** Load (or prepare) the attendance sheet for a class/date/period. */
export async function attendanceSheet(ctx: TenantContext, classAssignmentId: string, date: string, period: number) {
  assertCan(ctx, "attendance.mark");
  const { ca, subj } = await loadClass(ctx, classAssignmentId);
  const db = getDb();
  const roster = await rosterForSection(ctx, ca.sectionId);
  const [session] = await db
    .select()
    .from(attendanceSessions)
    .where(and(eq(attendanceSessions.classAssignmentId, ca.id), eq(attendanceSessions.date, date), eq(attendanceSessions.period, period)))
    .limit(1);
  const existing = session ? await db.select().from(attendanceRecords).where(eq(attendanceRecords.sessionId, session.id)) : [];
  const byStudent = new Map(existing.map((r) => [r.studentId, r]));
  return { ca, subject: subj, session: session ?? null, rows: roster.map((s) => ({ ...s, status: (byStudent.get(s.id)?.status ?? null) as AttendanceStatus | null, recordId: byStudent.get(s.id)?.id ?? null })) };
}

const markInput = z.object({
  classAssignmentId: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period: z.number().int().min(1).max(12),
  topic: z.string().max(200).nullable(),
  statuses: z.record(z.string(), z.enum(ATTENDANCE_STATUSES as [AttendanceStatus, ...AttendanceStatus[]])),
});

/**
 * Record attendance. First submission creates the session; re-submitting by the
 * same faculty within 48h overwrites directly. Later changes must go through
 * the correction workflow (approved by HOD / admin).
 */
export async function markAttendance(ctx: TenantContext, input: z.input<typeof markInput>) {
  assertAdminWrite(ctx, "attendance.mark");
  const d = markInput.parse(input);
  const today = new Date();
  if (new Date(`${d.date}T00:00:00`) > today) throw badRequest("Attendance cannot be marked for a future date.");
  const { ca, subj } = await loadClass(ctx, d.classAssignmentId);
  const roster = await rosterForSection(ctx, ca.sectionId);
  const rosterIds = new Set(roster.map((r) => r.id));
  const missing = roster.filter((r) => !d.statuses[r.id]);
  if (missing.length) throw badRequest(`Mark every student (missing ${missing.length}).`);
  for (const sid of Object.keys(d.statuses)) if (!rosterIds.has(sid)) throw badRequest("A student in the submission is not in this section.");

  const db = getDb();
  return db.transaction(async (tx) => {
    let [session] = await tx
      .select()
      .from(attendanceSessions)
      .where(and(eq(attendanceSessions.classAssignmentId, ca.id), eq(attendanceSessions.date, d.date), eq(attendanceSessions.period, d.period)))
      .limit(1);
    if (session) {
      const ageH = (Date.now() - session.createdAt.getTime()) / 36e5;
      const isApprover = ctx.perms.has("attendance.approve");
      if (ageH > 48 && !isApprover) throw badRequest("This attendance is locked (older than 48 hours). Submit a correction request instead.");
    } else {
      [session] = await tx
        .insert(attendanceSessions)
        .values({ institutionId: ctx.institution.id, classAssignmentId: ca.id, subjectId: ca.subjectId, sectionId: ca.sectionId, date: d.date, period: d.period, topic: d.topic, createdByUserId: ctx.user.id })
        .returning();
    }
    const values = Object.entries(d.statuses).map(([studentId, status]) => ({ institutionId: ctx.institution.id, sessionId: session.id, studentId, status }));
    await tx
      .insert(attendanceRecords)
      .values(values)
      .onConflictDoUpdate({ target: [attendanceRecords.sessionId, attendanceRecords.studentId], set: { status: sql`excluded.status`, updatedAt: new Date() } });
    const absent = values.filter((v) => v.status === "absent").length;
    await audit(ctx, { action: "attendance.mark", entityType: "attendance_session", entityId: session.id, summary: `Marked ${subj.code} ${d.date} P${d.period}: ${values.length - absent} present/late/excused, ${absent} absent` }, tx);
    return session;
  });
}

export async function requestCorrection(ctx: TenantContext, input: { recordId: string; toStatus: string; reason: string }) {
  assertWritable(ctx);
  if (!ctx.perms.has("attendance.mark") && !ctx.perms.has("attendance.approve")) throw forbidden();
  const rec = await owned(ctx, attendanceRecords, input.recordId, "Attendance record");
  const sess = await owned(ctx, attendanceSessions, rec.sessionId, "Attendance session");
  await loadClass(ctx, sess.classAssignmentId);
  const to = z.enum(ATTENDANCE_STATUSES as [AttendanceStatus, ...AttendanceStatus[]]).parse(input.toStatus);
  if (to === rec.status) throw badRequest("The new status is the same as the current one.");
  if (input.reason.trim().length < 5) throw badRequest("Give a reason for the correction.");
  const [row] = await getDb()
    .insert(attendanceCorrections)
    .values({ institutionId: ctx.institution.id, recordId: rec.id, fromStatus: rec.status, toStatus: to, reason: input.reason.trim(), requestedByUserId: ctx.user.id })
    .returning();
  await audit(ctx, { action: "attendance.correction_request", entityType: "attendance_record", entityId: rec.id, summary: `Requested correction ${rec.status} → ${to}` });
  return row;
}

export async function reviewCorrection(ctx: TenantContext, correctionId: string, decision: "approved" | "rejected") {
  assertAdminWrite(ctx, "attendance.approve");
  const c = await owned(ctx, attendanceCorrections, correctionId, "Correction");
  if (c.status !== "pending") throw badRequest("This correction was already reviewed.");
  if (c.requestedByUserId === ctx.user.id && ctx.role !== "college_admin") throw forbidden("You cannot approve your own correction request.");
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(attendanceCorrections).set({ status: decision, reviewedByUserId: ctx.user.id, reviewedAt: new Date() }).where(eq(attendanceCorrections.id, c.id));
    if (decision === "approved") await tx.update(attendanceRecords).set({ status: c.toStatus, updatedAt: new Date() }).where(and(eq(attendanceRecords.id, c.recordId), eq(attendanceRecords.institutionId, ctx.institution.id)));
    await audit(ctx, { action: `attendance.correction_${decision}`, entityType: "attendance_record", entityId: c.recordId, summary: `${decision === "approved" ? "Approved" : "Rejected"} correction ${c.fromStatus} → ${c.toStatus}` }, tx);
  });
}

export async function pendingCorrections(ctx: TenantContext) {
  assertCan(ctx, "attendance.approve");
  const rows = await getDb()
    .select({
      correction: attendanceCorrections,
      studentName: students.fullName,
      enrollmentNo: students.enrollmentNo,
      date: attendanceSessions.date,
      period: attendanceSessions.period,
      subjectCode: subjects.code,
      subjectDepartmentId: subjects.departmentId,
      requestedBy: users.name,
    })
    .from(attendanceCorrections)
    .innerJoin(attendanceRecords, eq(attendanceRecords.id, attendanceCorrections.recordId))
    .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
    .innerJoin(subjects, eq(subjects.id, attendanceSessions.subjectId))
    .innerJoin(students, eq(students.id, attendanceRecords.studentId))
    .leftJoin(users, eq(users.id, attendanceCorrections.requestedByUserId))
    .where(and(eq(attendanceCorrections.institutionId, ctx.institution.id), eq(attendanceCorrections.status, "pending")))
    .orderBy(desc(attendanceCorrections.createdAt));
  return ctx.scope.kind === "department" ? rows.filter((r) => r.subjectDepartmentId === ctx.departmentId) : rows;
}

/** Subject-wise + overall attendance for one student, using the college's rules. */
export async function studentAttendance(ctx: TenantContext, studentId: string) {
  const db = getDb();
  const rows = await db
    .select({ status: attendanceRecords.status, subjectId: attendanceSessions.subjectId, code: subjects.code, name: subjects.name, date: attendanceSessions.date, period: attendanceSessions.period })
    .from(attendanceRecords)
    .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
    .innerJoin(subjects, eq(subjects.id, attendanceSessions.subjectId))
    .where(and(eq(attendanceRecords.institutionId, ctx.institution.id), eq(attendanceRecords.studentId, studentId)))
    .orderBy(desc(attendanceSessions.date), desc(attendanceSessions.period));
  const bySubject = new Map<string, { code: string; name: string; statuses: AttendanceStatus[] }>();
  for (const r of rows) {
    const e = bySubject.get(r.subjectId) ?? { code: r.code, name: r.name, statuses: [] };
    e.statuses.push(r.status as AttendanceStatus);
    bySubject.set(r.subjectId, e);
  }
  return {
    overall: summarizeAttendance(rows.map((r) => r.status as AttendanceStatus), ctx.academic),
    subjects: [...bySubject.entries()].map(([subjectId, e]) => ({ subjectId, code: e.code, name: e.name, ...summarizeAttendance(e.statuses, ctx.academic) })).sort((a, b) => a.code.localeCompare(b.code)),
    history: rows.slice(0, 200),
    threshold: ctx.academic.attendanceThreshold,
  };
}

/** Per-student percentage for a section (optionally one subject). */
export async function sectionAttendanceReport(ctx: TenantContext, sectionId: string, subjectId?: string) {
  assertCan(ctx, "attendance.view_all");
  const roster = await rosterForSection(ctx, sectionId);
  if (!roster.length) return [];
  const conds = [eq(attendanceRecords.institutionId, ctx.institution.id), eq(attendanceSessions.sectionId, sectionId), inArray(attendanceRecords.studentId, roster.map((r) => r.id))];
  if (subjectId) conds.push(eq(attendanceSessions.subjectId, subjectId));
  const rows = await getDb()
    .select({ studentId: attendanceRecords.studentId, status: attendanceRecords.status })
    .from(attendanceRecords)
    .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
    .where(and(...conds));
  const by = new Map<string, AttendanceStatus[]>();
  for (const r of rows) by.set(r.studentId, [...(by.get(r.studentId) ?? []), r.status as AttendanceStatus]);
  return roster.map((s) => ({ ...s, ...summarizeAttendance(by.get(s.id) ?? [], ctx.academic) }));
}

/** Institution-wide aggregate for the dashboard (last 30 days). */
export async function attendanceOverview(ctx: TenantContext) {
  const [row] = await getDb()
    .select({
      total: sql<number>`count(*)::int`,
      present: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'present' or (${attendanceRecords.status} = 'late' and ${ctx.academic.lateCountsAsPresent}))::int`,
      excused: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'excused')::int`,
      sessions: sql<number>`count(distinct ${attendanceSessions.id})::int`,
    })
    .from(attendanceRecords)
    .innerJoin(attendanceSessions, eq(attendanceSessions.id, attendanceRecords.sessionId))
    .where(and(eq(attendanceRecords.institutionId, ctx.institution.id), sql`${attendanceSessions.date} >= current_date - 30`));
  const denom = ctx.academic.excludeExcused ? row.total - row.excused : row.total;
  return { sessions: row.sessions, records: row.total, percentage: denom > 0 ? Math.round((row.present / denom) * 1000) / 10 : null };
}

export async function recentSessions(ctx: TenantContext, limit = 20) {
  const conds = [eq(attendanceSessions.institutionId, ctx.institution.id)];
  if (ctx.scope.kind === "classes") conds.push(inArray(attendanceSessions.classAssignmentId, ctx.classes.length ? ctx.classes.map((c) => c.id) : ["00000000-0000-0000-0000-000000000000"]));
  if (ctx.scope.kind === "department" && ctx.departmentId) conds.push(eq(subjects.departmentId, ctx.departmentId));
  return getDb()
    .select({
      session: attendanceSessions,
      subjectCode: subjects.code,
      present: sql<number>`(select count(*)::int from ${attendanceRecords} r where r.session_id = ${ref(attendanceSessions.id)} and r.status in ('present','late'))`,
      total: sql<number>`(select count(*)::int from ${attendanceRecords} r where r.session_id = ${ref(attendanceSessions.id)})`,
    })
    .from(attendanceSessions)
    .innerJoin(subjects, eq(subjects.id, attendanceSessions.subjectId))
    .where(and(...conds))
    .orderBy(desc(attendanceSessions.date), desc(attendanceSessions.createdAt))
    .limit(limit);
}
