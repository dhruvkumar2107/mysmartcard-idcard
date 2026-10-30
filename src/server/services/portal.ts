import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { departments, programmes, sections, students } from "@/db/schema";
import { forbidden } from "@/lib/errors";
import { feature, moduleVisibleToStudent, orderedModules, type ModuleKey, type PortalConfig } from "@/lib/portal-config";
import { audit } from "../audit";
import type { TenantContext } from "../context";
import { studentAttendance } from "./attendance";
import { examSchedule, publishedResultsForStudent } from "./assessments";
import { cardsForStudent } from "./cards";
import { courseworkForStudent } from "./coursework";
import { studentLedger } from "./finance";
import { loansForStudent, renewalEligibility } from "./library";
import { noticeFeed, noticesForStudent } from "./notices";
import { upcomingEvents } from "./timetable";
import { timetableImagesForStudent } from "./timetable-images";
import { transportForStudent } from "./transport";
import { owned } from "./guard";

/**
 * A portal "viewer" is either the signed-in student (published config), a college
 * administrator previewing a student (published config, read-only), or the platform
 * super admin previewing a DRAFT. All paths go through the same module gate and the
 * same feature-flag stripping, so a hidden module or value is unreachable — not
 * merely hidden in the UI.
 */
export type PortalViewer = { ctx: TenantContext; studentId: string; config: PortalConfig; preview: boolean };

export async function viewerForStudent(ctx: TenantContext): Promise<PortalViewer> {
  if (ctx.role !== "student" || !ctx.studentId) throw forbidden("The student portal is for student accounts.");
  return { ctx, studentId: ctx.studentId, config: ctx.portalConfig, preview: false };
}

/** College staff with portal.configure can see exactly what a student sees (published settings). */
export async function viewerForPreview(ctx: TenantContext, studentId: string): Promise<PortalViewer> {
  if (!ctx.perms.has("portal.configure")) throw forbidden();
  const s = await owned(ctx, students, studentId, "Student");
  return { ctx, studentId: s.id, config: ctx.portalConfig, preview: true };
}

/** Super-admin preview of a draft configuration, rendered for a real student and audited. */
export async function viewerForPlatformPreview(ctx: TenantContext, studentId: string, config: PortalConfig): Promise<PortalViewer> {
  if (!ctx.user.isSuperAdmin) throw forbidden();
  const s = await owned(ctx, students, studentId, "Student");
  await audit(ctx, { action: "portal.preview", entityType: "student", entityId: s.id, summary: `Previewed draft student portal as ${s.enrollmentNo}` });
  return { ctx, studentId: s.id, config, preview: true };
}

export async function portalStudent(v: PortalViewer) {
  const [row] = await getDb()
    .select({ student: students, department: departments, programme: programmes, section: sections })
    .from(students)
    .leftJoin(departments, eq(departments.id, students.departmentId))
    .leftJoin(programmes, eq(programmes.id, students.programmeId))
    .leftJoin(sections, eq(sections.id, students.sectionId))
    .where(and(eq(students.id, v.studentId), eq(students.institutionId, v.ctx.institution.id)))
    .limit(1);
  if (!row) throw forbidden();
  return row;
}

export type PortalStudent = Awaited<ReturnType<typeof portalStudent>>;

export function visibleModules(v: PortalViewer, s: PortalStudent["student"]): ModuleKey[] {
  return orderedModules(v.config).filter((k) => moduleVisibleToStudent(v.config, k, s));
}

function gate(v: PortalViewer, s: PortalStudent["student"], key: ModuleKey) {
  if (!moduleVisibleToStudent(v.config, key, s)) throw forbidden("This section is not available in your portal.");
}

/** Remove CGPA/SGPA unless the super admin enabled them. Subject results stay. */
function stripResults(v: PortalViewer, data: Awaited<ReturnType<typeof publishedResultsForStudent>>) {
  if (feature(v.config, "showCGPA")) return data;
  return { ...data, cgpa: null, semesters: data.semesters.map((s) => ({ ...s, sgpa: null })) };
}

/** Remove due dates unless assignment deadlines are enabled. */
function stripCoursework(v: PortalViewer, items: Awaited<ReturnType<typeof courseworkForStudent>>) {
  if (feature(v.config, "showAssignmentDeadlines")) return items;
  return items.map((i) => ({ ...i, item: { ...i.item, dueAt: null } }));
}

/** Remove fee due dates / overdue states unless fee reminders are enabled. */
function stripLedger(v: PortalViewer, ledger: Awaited<ReturnType<typeof studentLedger>>) {
  if (feature(v.config, "showFeeDueReminders")) return ledger;
  return { ...ledger, demands: ledger.demands.map((d) => ({ ...d, dueDate: null, status: d.status === "overdue" ? "due" : d.status })) };
}

export async function loadModule(v: PortalViewer, key: ModuleKey, opts: { q?: string; page?: number } = {}) {
  const me = await portalStudent(v);
  gate(v, me.student, key);
  const ctx = v.ctx;
  const sid = me.student.id;
  switch (key) {
    case "digital_id":
      return { key, me, cards: await cardsForStudent(ctx, sid) };
    case "attendance":
      return { key, me, data: await studentAttendance(ctx, sid) };
    case "results":
    case "internal_marks":
      return { key, me, data: stripResults(v, await publishedResultsForStudent(ctx, sid)) };
    case "timetable": {
      const secIds = me.student.sectionId ? [me.student.sectionId] : [];
      const [images, events, exams] = await Promise.all([timetableImagesForStudent(ctx, me.student), upcomingEvents(ctx, me.student.sectionId, 20), examSchedule(ctx, secIds)]);
      return { key, me, images, events, exams };
    }
    case "notices":
      return { key, me, feed: await noticeFeed(ctx, { kind: "student", student: me.student }, { q: opts.q, page: opts.page }) };
    case "coursework":
      return { key, me, items: stripCoursework(v, await courseworkForStudent(ctx, me.student)) };
    case "fees":
      return { key, me, ledger: stripLedger(v, await studentLedger(ctx, sid)) };
    case "library": {
      const loans = await loansForStudent(ctx, sid);
      const notices = (await noticesForStudent(ctx, me.student)).filter((n) => n.category === "library").slice(0, 5);
      return { key, me, loans: loans.map((l) => ({ ...l, renewal: renewalEligibility(l.loan) })), notices };
    }
    case "transport": {
      const t = await transportForStudent(ctx, sid);
      const notices = (await noticesForStudent(ctx, me.student)).filter((n) => n.category === "transport").slice(0, 5);
      return { key, me, transport: t, notices };
    }
  }
}

/**
 * Compact data for the portal home. Each value is only loaded when its module AND
 * its data flag are enabled; otherwise it is null and never reaches the page.
 */
export async function portalHome(v: PortalViewer) {
  const me = await portalStudent(v);
  const mods = visibleModules(v, me.student);
  const has = (k: ModuleKey) => mods.includes(k);
  const ctx = v.ctx;
  const showCgpa = has("results") && feature(v.config, "showCGPA");
  const showDue = has("coursework") && feature(v.config, "showAssignmentDeadlines");
  const [attendance, results, fees, feed, coursework, timetables] = await Promise.all([
    has("attendance") ? studentAttendance(ctx, me.student.id) : null,
    showCgpa ? publishedResultsForStudent(ctx, me.student.id) : null,
    has("fees") ? studentLedger(ctx, me.student.id) : null,
    has("notices") ? noticeFeed(ctx, { kind: "student", student: me.student }, { pageSize: 4 }) : null,
    has("coursework") ? courseworkForStudent(ctx, me.student) : null,
    has("timetable") ? timetableImagesForStudent(ctx, me.student) : null,
  ]);
  const now = Date.now();
  return {
    me,
    modules: mods,
    attendance: attendance?.overall ?? null,
    threshold: attendance?.threshold ?? null,
    cgpa: results?.cgpa ?? null,
    balance: fees?.balance ?? null,
    notices: feed?.items ?? null,
    unreadNotices: feed?.unread ?? null,
    assignments: coursework?.length ?? null,
    latestAssignment: coursework?.[0] ? { title: coursework[0].item.title, subject: coursework[0].subjectCode } : null,
    timetable: timetables?.[0] ? { title: timetables[0].t.title, updatedAt: timetables[0].t.updatedAt } : null,
    dueAssignments: showDue ? (coursework?.filter((c) => c.item.kind === "assignment" && !c.submission && c.item.dueAt && c.item.dueAt.getTime() > now).length ?? null) : null,
  };
}