import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ref } from "@/db/sql";
import { getDb } from "@/db";
import { classAssignments, departments, faculty, programmes, sections, subjects, students } from "@/db/schema";
import { badRequest } from "@/lib/errors";
import { audit } from "../audit";
import { assertAdminWrite, type TenantContext } from "../context";
import { owned } from "./guard";

const code = z.string().trim().toUpperCase().min(1).max(20).regex(/^[A-Z0-9_-]+$/, "Codes may contain letters, digits, - and _");

export async function listStructure(ctx: TenantContext) {
  const db = getDb();
  const inst = ctx.institution.id;
  const [deps, progs, secs, subs] = await Promise.all([
    db.select().from(departments).where(eq(departments.institutionId, inst)).orderBy(asc(departments.name)),
    db.select().from(programmes).where(eq(programmes.institutionId, inst)).orderBy(asc(programmes.name)),
    db
      .select({
        section: sections,
        programmeCode: programmes.code,
        studentCount: sql<number>`(select count(*)::int from ${students} s where s.section_id = ${ref(sections.id)} and s.status = 'active')`,
      })
      .from(sections)
      .innerJoin(programmes, eq(programmes.id, sections.programmeId))
      .where(eq(sections.institutionId, inst))
      .orderBy(asc(programmes.code), asc(sections.semester), asc(sections.name)),
    db.select().from(subjects).where(eq(subjects.institutionId, inst)).orderBy(asc(subjects.semester), asc(subjects.code)),
  ]);
  return { departments: deps, programmes: progs, sections: secs, subjects: subs };
}

export function sectionLabel(s: { programmeCode: string; section: { semester: number; name: string; academicYear: string } }) {
  return `${s.programmeCode} · Sem ${s.section.semester} · ${s.section.name} (${s.section.academicYear})`;
}

export async function createDepartment(ctx: TenantContext, input: { code: string; name: string }) {
  assertAdminWrite(ctx, "academics.manage");
  const data = z.object({ code, name: z.string().trim().min(2).max(120) }).parse(input);
  const [row] = await getDb().insert(departments).values({ ...data, institutionId: ctx.institution.id }).returning();
  await audit(ctx, { action: "department.create", entityType: "department", entityId: row.id, summary: `Created department ${row.code} – ${row.name}` });
  return row;
}

export async function createProgramme(ctx: TenantContext, input: { departmentId: string; code: string; name: string; durationSemesters: number }) {
  assertAdminWrite(ctx, "academics.manage");
  const data = z.object({ departmentId: z.string(), code, name: z.string().trim().min(2).max(160), durationSemesters: z.number().int().min(1).max(12) }).parse(input);
  await owned(ctx, departments, data.departmentId, "Department");
  const [row] = await getDb().insert(programmes).values({ ...data, institutionId: ctx.institution.id }).returning();
  await audit(ctx, { action: "programme.create", entityType: "programme", entityId: row.id, summary: `Created programme ${row.code}` });
  return row;
}

export async function createSection(ctx: TenantContext, input: { programmeId: string; semester: number; name: string; academicYear: string }) {
  assertAdminWrite(ctx, "academics.manage");
  const data = z
    .object({ programmeId: z.string(), semester: z.number().int().min(1).max(12), name: z.string().trim().toUpperCase().min(1).max(10), academicYear: z.string().regex(/^\d{4}-\d{2}$/, "Academic year must look like 2026-27") })
    .parse(input);
  const prog = await owned(ctx, programmes, data.programmeId, "Programme");
  if (data.semester > prog.durationSemesters) throw badRequest(`${prog.code} only has ${prog.durationSemesters} semesters.`);
  const [row] = await getDb().insert(sections).values({ ...data, institutionId: ctx.institution.id }).returning();
  await audit(ctx, { action: "section.create", entityType: "section", entityId: row.id, summary: `Created section ${prog.code} S${row.semester}-${row.name}` });
  return row;
}

export async function createSubject(ctx: TenantContext, input: { departmentId: string; programmeId: string | null; semester: number; code: string; name: string; credits: number; kind: string }) {
  assertAdminWrite(ctx, "academics.manage");
  const data = z
    .object({
      departmentId: z.string(),
      programmeId: z.string().nullable(),
      semester: z.number().int().min(1).max(12),
      code,
      name: z.string().trim().min(2).max(160),
      credits: z.number().int().min(0).max(30),
      kind: z.enum(["theory", "lab"]),
    })
    .parse(input);
  await owned(ctx, departments, data.departmentId, "Department");
  if (data.programmeId) await owned(ctx, programmes, data.programmeId, "Programme");
  const [row] = await getDb().insert(subjects).values({ ...data, institutionId: ctx.institution.id }).returning();
  await audit(ctx, { action: "subject.create", entityType: "subject", entityId: row.id, summary: `Created subject ${row.code} – ${row.name}` });
  return row;
}

export async function assignClass(ctx: TenantContext, input: { facultyId: string; subjectId: string; sectionId: string }) {
  assertAdminWrite(ctx, "academics.manage");
  const f = await owned(ctx, faculty, input.facultyId, "Faculty member");
  const s = await owned(ctx, subjects, input.subjectId, "Subject");
  const sec = await owned(ctx, sections, input.sectionId, "Section");
  const [row] = await getDb().insert(classAssignments).values({ institutionId: ctx.institution.id, facultyId: f.id, subjectId: s.id, sectionId: sec.id }).returning();
  await audit(ctx, { action: "class.assign", entityType: "class_assignment", entityId: row.id, summary: `Assigned ${f.name} to ${s.code} (sem ${sec.semester}-${sec.name})` });
  return row;
}

export async function unassignClass(ctx: TenantContext, id: string) {
  assertAdminWrite(ctx, "academics.manage");
  const row = await owned(ctx, classAssignments, id, "Teaching assignment");
  await getDb().delete(classAssignments).where(and(eq(classAssignments.id, row.id), eq(classAssignments.institutionId, ctx.institution.id)));
  await audit(ctx, { action: "class.unassign", entityType: "class_assignment", entityId: id, summary: "Removed teaching assignment" });
}

export async function listClassAssignments(ctx: TenantContext, opts: { mineOnly?: boolean } = {}) {
  const db = getDb();
  const conds = [eq(classAssignments.institutionId, ctx.institution.id)];
  if (opts.mineOnly) conds.push(eq(classAssignments.facultyId, ctx.facultyId ?? "00000000-0000-0000-0000-000000000000"));
  return db
    .select({
      id: classAssignments.id,
      facultyId: faculty.id,
      facultyName: faculty.name,
      subjectId: subjects.id,
      subjectCode: subjects.code,
      subjectName: subjects.name,
      subjectKind: subjects.kind,
      sectionId: sections.id,
      semester: sections.semester,
      sectionName: sections.name,
      academicYear: sections.academicYear,
      programmeCode: programmes.code,
      departmentId: subjects.departmentId,
    })
    .from(classAssignments)
    .innerJoin(faculty, eq(faculty.id, classAssignments.facultyId))
    .innerJoin(subjects, eq(subjects.id, classAssignments.subjectId))
    .innerJoin(sections, eq(sections.id, classAssignments.sectionId))
    .innerJoin(programmes, eq(programmes.id, sections.programmeId))
    .where(and(...conds))
    .orderBy(asc(subjects.code));
}

/** Classes the caller may act on: own classes, department classes for HOD, all for admins. */
export async function actionableClasses(ctx: TenantContext) {
  const all = await listClassAssignments(ctx);
  if (ctx.scope.kind === "all") return all;
  const mine = new Set(ctx.classes.map((c) => c.id));
  if (ctx.scope.kind === "department") return all.filter((c) => c.departmentId === ctx.departmentId || mine.has(c.id));
  return all.filter((c) => mine.has(c.id));
}
