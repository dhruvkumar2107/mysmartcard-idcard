import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { departments, programmes, sections, students } from "@/db/schema";
import { forbidden } from "@/lib/errors";
import { moduleVisibleToStudent, orderedModules, type ModuleKey, type PortalConfig } from "@/lib/portal-config";
import type { TenantContext } from "../context";
import { studentAttendance } from "./attendance";
import { examSchedule, publishedResultsForStudent } from "./assessments";
import { cardsForStudent } from "./cards";
import { courseworkForStudent } from "./coursework";
import { studentLedger } from "./finance";
import { loansForStudent, renewalEligibility } from "./library";
import { noticesForStudent } from "./notices";
import { timetableFor, upcomingEvents } from "./timetable";
import { transportForStudent } from "./transport";
import { owned } from "./guard";

/**
 * A portal "viewer" is either the signed-in student (published config) or an
 * administrator previewing a student with the DRAFT config. Both paths go
 * through the same module gate, so a disabled module is unreachable — not
 * merely hidden.
 */
export type PortalViewer = { ctx: TenantContext; studentId: string; config: PortalConfig; preview: boolean };

export async function viewerForStudent(ctx: TenantContext): Promise<PortalViewer> {
  if (ctx.role !== "student" || !ctx.studentId) throw forbidden("The student portal is for student accounts.");
  return { ctx, studentId: ctx.studentId, config: ctx.portalConfig, preview: false };
}

export async function viewerForPreview(ctx: TenantContext, studentId: string): Promise<PortalViewer> {
  if (!ctx.perms.has("portal.configure")) throw forbidden();
  const s = await owned(ctx, students, studentId, "Student");
  return { ctx, studentId: s.id, config: ctx.draftConfig, preview: true };
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

export async function loadModule(v: PortalViewer, key: ModuleKey, opts: { q?: string } = {}) {
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
      return { key, me, data: await publishedResultsForStudent(ctx, sid) };
    case "timetable": {
      const secIds = me.student.sectionId ? [me.student.sectionId] : [];
      const [slots, events, exams] = await Promise.all([timetableFor(ctx, { sectionIds: secIds }), upcomingEvents(ctx, me.student.sectionId, 20), examSchedule(ctx, secIds)]);
      return { key, me, slots, events, exams };
    }
    case "notices":
      return { key, me, notices: await noticesForStudent(ctx, me.student, opts.q) };
    case "coursework":
      return { key, me, items: await courseworkForStudent(ctx, me.student) };
    case "fees":
      return { key, me, ledger: await studentLedger(ctx, sid) };
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

/** Compact data for the portal home. Each tile only loads if its module is visible. */
export async function portalHome(v: PortalViewer) {
  const me = await portalStudent(v);
  const mods = visibleModules(v, me.student);
  const has = (k: ModuleKey) => mods.includes(k);
  const ctx = v.ctx;
  const [attendance, results, fees, notices, coursework] = await Promise.all([
    has("attendance") ? studentAttendance(ctx, me.student.id) : null,
    has("results") ? publishedResultsForStudent(ctx, me.student.id) : null,
    has("fees") ? studentLedger(ctx, me.student.id) : null,
    has("notices") ? noticesForStudent(ctx, me.student) : null,
    has("coursework") ? courseworkForStudent(ctx, me.student) : null,
  ]);
  const now = Date.now();
  return {
    me,
    modules: mods,
    attendance: attendance?.overall ?? null,
    threshold: attendance?.threshold ?? null,
    cgpa: results?.cgpa ?? null,
    balance: fees?.balance ?? null,
    notices: notices?.slice(0, 3) ?? null,
    dueAssignments: coursework?.filter((c) => c.item.kind === "assignment" && !c.submission && c.item.dueAt && c.item.dueAt.getTime() > now).length ?? null,
  };
}
