import { and, count, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { assessments, attendanceCorrections, faculty, students } from "@/db/schema";
import type { TenantContext } from "../context";
import { attendanceOverview } from "./attendance";
import { upcomingExams } from "./assessments";
import { cardCounts } from "./cards";
import { recentLiveNotices } from "./notices";
import { studentCountsByDepartment } from "./students";
import { upcomingEvents } from "./timetable";

/** Every number here is computed from live records — nothing is hard-coded. */
export async function dashboard(ctx: TenantContext) {
  const db = getDb();
  const inst = ctx.institution.id;
  const [[stu], [fac], cards, byDept, attendance, exams, notices, [pendingResults], [pendingCorrections], events] = await Promise.all([
    db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${students.status} = 'active')::int`,
        inactive: sql<number>`count(*) filter (where ${students.status} in ('inactive','suspended'))::int`,
        graduated: sql<number>`count(*) filter (where ${students.status} = 'graduated')::int`,
      })
      .from(students)
      .where(and(eq(students.institutionId, inst), sql`${students.status} <> 'archived'`)),
    db.select({ total: count() }).from(faculty).where(and(eq(faculty.institutionId, inst), eq(faculty.status, "active"))),
    cardCounts(ctx),
    studentCountsByDepartment(ctx),
    attendanceOverview(ctx),
    upcomingExams(ctx),
    recentLiveNotices(ctx),
    db.select({ n: count() }).from(assessments).where(and(eq(assessments.institutionId, inst), sql`${assessments.status} in ('submitted','approved')`)),
    db.select({ n: count() }).from(attendanceCorrections).where(and(eq(attendanceCorrections.institutionId, inst), eq(attendanceCorrections.status, "pending"))),
    upcomingEvents(ctx, undefined, 6),
  ]);
  return { students: stu, faculty: fac.total, cards, byDept, attendance, exams, notices, pendingResults: pendingResults.n, pendingCorrections: pendingCorrections.n, events };
}
