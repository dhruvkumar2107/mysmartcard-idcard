import { and, asc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { calendarEvents, faculty, sections, subjects, timetableEntries } from "@/db/schema";
import { badRequest } from "@/lib/errors";
import { findConflicts } from "@/lib/timetable";
import { audit } from "../audit";
import { assertAdminWrite, type TenantContext } from "../context";
import { owned, ownedOrNull } from "./guard";

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM");
const entryInput = z.object({
  sectionId: z.string(),
  subjectId: z.string(),
  facultyId: z.string().nullable(),
  room: z.string().trim().min(1).max(40),
  dayOfWeek: z.number().int().min(1).max(6),
  startTime: hhmm,
  endTime: hhmm,
});

export async function addTimetableEntry(ctx: TenantContext, input: z.input<typeof entryInput>) {
  assertAdminWrite(ctx, "timetable.manage");
  const d = entryInput.parse(input);
  await owned(ctx, sections, d.sectionId, "Section");
  await owned(ctx, subjects, d.subjectId, "Subject");
  await ownedOrNull(ctx, faculty, d.facultyId, "Faculty member");
  const db = getDb();
  const sameDay = await db
    .select()
    .from(timetableEntries)
    .where(and(eq(timetableEntries.institutionId, ctx.institution.id), eq(timetableEntries.dayOfWeek, d.dayOfWeek)));
  const conflicts = findConflicts(d, sameDay);
  if (conflicts.length) throw badRequest(`Scheduling conflict: ${conflicts.map((c) => c.message).join(" ")}`);
  const [row] = await db.insert(timetableEntries).values({ ...d, institutionId: ctx.institution.id }).returning();
  await audit(ctx, { action: "timetable.add", entityType: "timetable_entry", entityId: row.id, summary: `Added timetable slot day ${d.dayOfWeek} ${d.startTime}-${d.endTime} room ${d.room}` });
  return row;
}

export async function removeTimetableEntry(ctx: TenantContext, id: string) {
  assertAdminWrite(ctx, "timetable.manage");
  const e = await owned(ctx, timetableEntries, id, "Timetable slot");
  await getDb().delete(timetableEntries).where(and(eq(timetableEntries.id, e.id), eq(timetableEntries.institutionId, ctx.institution.id)));
  await audit(ctx, { action: "timetable.remove", entityType: "timetable_entry", entityId: id, summary: `Removed timetable slot day ${e.dayOfWeek} ${e.startTime}` });
}

export async function timetableFor(ctx: TenantContext, filter: { sectionIds?: string[]; facultyId?: string }) {
  const conds = [eq(timetableEntries.institutionId, ctx.institution.id)];
  if (filter.sectionIds) {
    if (!filter.sectionIds.length) return [];
    conds.push(inArray(timetableEntries.sectionId, filter.sectionIds));
  }
  if (filter.facultyId) conds.push(eq(timetableEntries.facultyId, filter.facultyId));
  return getDb()
    .select({ entry: timetableEntries, subjectCode: subjects.code, subjectName: subjects.name, subjectKind: subjects.kind, facultyName: faculty.name, semester: sections.semester, sectionName: sections.name })
    .from(timetableEntries)
    .innerJoin(subjects, eq(subjects.id, timetableEntries.subjectId))
    .innerJoin(sections, eq(sections.id, timetableEntries.sectionId))
    .leftJoin(faculty, eq(faculty.id, timetableEntries.facultyId))
    .where(and(...conds))
    .orderBy(asc(timetableEntries.dayOfWeek), asc(timetableEntries.startTime));
}

const eventInput = z.object({
  title: z.string().trim().min(2).max(160),
  kind: z.enum(["holiday", "schedule_change", "event", "deadline"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  sectionId: z.string().nullable(),
  description: z.string().max(1000).nullable(),
});

export async function addCalendarEvent(ctx: TenantContext, input: z.input<typeof eventInput>) {
  assertAdminWrite(ctx, "timetable.manage");
  const d = eventInput.parse(input);
  if (d.endDate && d.endDate < d.startDate) throw badRequest("End date must be on or after start date.");
  await ownedOrNull(ctx, sections, d.sectionId, "Section");
  const [row] = await getDb().insert(calendarEvents).values({ ...d, institutionId: ctx.institution.id }).returning();
  await audit(ctx, { action: "calendar.add", entityType: "calendar_event", entityId: row.id, summary: `Added ${d.kind}: ${d.title} (${d.startDate})` });
  return row;
}

export async function removeCalendarEvent(ctx: TenantContext, id: string) {
  assertAdminWrite(ctx, "timetable.manage");
  const e = await owned(ctx, calendarEvents, id, "Event");
  await getDb().delete(calendarEvents).where(eq(calendarEvents.id, e.id));
  await audit(ctx, { action: "calendar.remove", entityType: "calendar_event", entityId: id, summary: `Removed ${e.kind}: ${e.title}` });
}

export async function upcomingEvents(ctx: TenantContext, sectionId?: string | null, limit = 20) {
  const conds = [eq(calendarEvents.institutionId, ctx.institution.id), gte(sql`coalesce(${calendarEvents.endDate}, ${calendarEvents.startDate})`, sql`current_date`)];
  if (sectionId !== undefined) conds.push(sectionId ? or(isNull(calendarEvents.sectionId), eq(calendarEvents.sectionId, sectionId))! : isNull(calendarEvents.sectionId));
  return getDb().select().from(calendarEvents).where(and(...conds)).orderBy(asc(calendarEvents.startDate)).limit(limit);
}
