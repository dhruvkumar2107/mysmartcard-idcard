import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { auditLogs, departments, files, memberships, programmes, sections, students, users } from "@/db/schema";
import { generateTempPassword } from "@/lib/crypto";
import { badRequest, forbidden } from "@/lib/errors";
import { validateImport, type ImportRow } from "@/lib/student-import";
import { newStorageKey, storage, validateUpload } from "@/lib/storage";
import { hashPassword } from "../auth";
import { audit } from "../audit";
import { assertAdminWrite, assertCan, studentScope, type TenantContext } from "../context";
import { isUuid, owned, ownedOrNull } from "./guard";

export const STUDENT_STATUSES = ["active", "inactive", "suspended", "graduated", "archived"] as const;
export const SENSITIVE_FIELDS = ["dateOfBirth", "address", "guardianName", "guardianPhone"] as const;

export type StudentRow = typeof students.$inferSelect;

export function redact<T extends Partial<StudentRow>>(ctx: TenantContext, s: T): T {
  if (ctx.perms.has("students.view_sensitive")) return s;
  const copy = { ...s };
  for (const f of SENSITIVE_FIELDS) if (f in copy) (copy as Record<string, unknown>)[f] = null;
  return copy;
}

export type StudentListQuery = {
  q?: string;
  status?: string;
  departmentId?: string;
  programmeId?: string;
  semester?: number;
  sectionId?: string;
  sort?: "name" | "enrollment" | "recent";
  page?: number;
  pageSize?: number;
};

export async function listStudents(ctx: TenantContext, query: StudentListQuery) {
  assertCan(ctx, "students.view");
  const db = getDb();
  const conds: SQL[] = [studentScope(ctx)];
  if (query.status && query.status !== "all") conds.push(eq(students.status, query.status));
  else if (!query.status) conds.push(ne(students.status, "archived"));
  if (isUuid(query.departmentId)) conds.push(eq(students.departmentId, query.departmentId));
  if (isUuid(query.programmeId)) conds.push(eq(students.programmeId, query.programmeId));
  if (isUuid(query.sectionId)) conds.push(eq(students.sectionId, query.sectionId));
  if (query.semester) conds.push(eq(students.semester, query.semester));
  if (query.q?.trim()) {
    const term = `%${query.q.trim().replace(/[%_]/g, "\\$&")}%`;
    conds.push(or(ilike(students.fullName, term), ilike(students.enrollmentNo, term), ilike(students.email, term))!);
  }
  const where = and(...conds);
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 5), 200);
  const page = Math.max(query.page ?? 1, 1);
  const order = query.sort === "enrollment" ? asc(students.enrollmentNo) : query.sort === "recent" ? desc(students.createdAt) : asc(students.fullName);

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        student: students,
        departmentCode: departments.code,
        programmeCode: programmes.code,
        sectionName: sections.name,
      })
      .from(students)
      .leftJoin(departments, eq(departments.id, students.departmentId))
      .leftJoin(programmes, eq(programmes.id, students.programmeId))
      .leftJoin(sections, eq(sections.id, students.sectionId))
      .where(where)
      .orderBy(order, asc(students.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(students).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r, student: redact(ctx, r.student) })), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Load one student, enforcing both tenant and role scope. */
export async function getStudent(ctx: TenantContext, id: string) {
  assertCan(ctx, "students.view");
  if (!isUuid(id)) throw forbidden("Student not found or outside your scope.");
  const [row] = await getDb()
    .select({ student: students, department: departments, programme: programmes, section: sections })
    .from(students)
    .leftJoin(departments, eq(departments.id, students.departmentId))
    .leftJoin(programmes, eq(programmes.id, students.programmeId))
    .leftJoin(sections, eq(sections.id, students.sectionId))
    .where(and(studentScope(ctx), eq(students.id, id)))
    .limit(1);
  if (!row) throw forbidden("Student not found or outside your scope.");
  return { ...row, student: redact(ctx, row.student) };
}

const studentInput = z.object({
  enrollmentNo: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9/_-]+$/, "Enrollment number has invalid characters"),
  fullName: z.string().trim().min(2).max(120),
  email: z.email().nullable(),
  phone: z.string().trim().max(20).nullable(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  gender: z.string().max(20).nullable(),
  guardianName: z.string().max(120).nullable(),
  guardianPhone: z.string().max(20).nullable(),
  address: z.string().max(500).nullable(),
  bloodGroup: z.string().max(5).nullable(),
  departmentId: z.string().nullable(),
  programmeId: z.string().nullable(),
  sectionId: z.string().nullable(),
  semester: z.number().int().min(1).max(12),
  academicYear: z.string().regex(/^\d{4}-\d{2}$/, "Academic year must look like 2026-27"),
  admissionYear: z.number().int().min(1990).max(2100).nullable(),
  status: z.enum(STUDENT_STATUSES),
});
export type StudentInput = z.input<typeof studentInput>;

async function validateRefs(ctx: TenantContext, d: z.infer<typeof studentInput>) {
  const dep = await ownedOrNull(ctx, departments, d.departmentId, "Department");
  const prog = await ownedOrNull(ctx, programmes, d.programmeId, "Programme");
  const sec = await ownedOrNull(ctx, sections, d.sectionId, "Section");
  if (prog && dep && prog.departmentId !== dep.id) throw badRequest("Programme does not belong to the selected department.");
  if (sec && prog && sec.programmeId !== prog.id) throw badRequest("Section does not belong to the selected programme.");
  if (sec && sec.semester !== d.semester) throw badRequest(`Section is for semester ${sec.semester}.`);
}

async function assertCapacity(ctx: TenantContext, adding: number) {
  const [{ total }] = await getDb()
    .select({ total: count() })
    .from(students)
    .where(and(eq(students.institutionId, ctx.institution.id), ne(students.status, "archived")));
  if (total + adding > ctx.institution.studentLimit)
    throw badRequest(`Your subscription allows ${ctx.institution.studentLimit} active students (currently ${total}). Contact platform support to increase it.`);
}

export async function createStudent(ctx: TenantContext, input: StudentInput) {
  assertAdminWrite(ctx, "students.edit");
  const d = studentInput.parse(input);
  await validateRefs(ctx, d);
  await assertCapacity(ctx, 1);
  const [row] = await getDb()
    .insert(students)
    .values({ ...d, enrollmentNo: d.enrollmentNo.toUpperCase(), institutionId: ctx.institution.id })
    .returning();
  await audit(ctx, { action: "student.create", entityType: "student", entityId: row.id, summary: `Created student ${row.enrollmentNo} – ${row.fullName}` });
  return row;
}

export async function updateStudent(ctx: TenantContext, id: string, input: StudentInput) {
  assertAdminWrite(ctx, "students.edit");
  await getStudent(ctx, id); // role scope (department / classes), not just tenant
  const before = await owned(ctx, students, id, "Student");
  const d = studentInput.parse(input);
  await validateRefs(ctx, d);
  // Users without sensitive access must not be able to overwrite sensitive fields they cannot see.
  const patch: Partial<StudentRow> = { ...d, enrollmentNo: d.enrollmentNo.toUpperCase(), updatedAt: new Date() };
  if (!ctx.perms.has("students.view_sensitive")) for (const f of SENSITIVE_FIELDS) delete patch[f];
  if (d.status === "archived" && before.status !== "archived") patch.archivedAt = new Date();
  const [row] = await getDb()
    .update(students)
    .set(patch)
    .where(and(eq(students.id, before.id), eq(students.institutionId, ctx.institution.id)))
    .returning();
  const changed = Object.keys(patch).filter((k) => k !== "updatedAt" && String((before as Record<string, unknown>)[k] ?? "") !== String((patch as Record<string, unknown>)[k] ?? ""));
  if (changed.length)
    await audit(ctx, {
      action: "student.update",
      entityType: "student",
      entityId: row.id,
      summary: `Updated ${row.enrollmentNo}: ${changed.join(", ")}`,
      metadata: { changed: Object.fromEntries(changed.map((k) => [k, SENSITIVE_FIELDS.includes(k as never) ? "[redacted]" : { from: (before as Record<string, unknown>)[k], to: (patch as Record<string, unknown>)[k] }])) },
    });
  return row;
}

export async function setStudentStatus(ctx: TenantContext, ids: string[], status: (typeof STUDENT_STATUSES)[number]) {
  assertAdminWrite(ctx, status === "archived" || status === "active" ? "students.archive" : "students.edit");
  if (!STUDENT_STATUSES.includes(status)) throw badRequest("Invalid status.");
  const valid = ids.filter(isUuid);
  if (!valid.length) throw badRequest("Select at least one student.");
  if (valid.length > 500) throw badRequest("Bulk actions are limited to 500 students at a time.");
  if (status === "active") await assertCapacity(ctx, 0);
  const updated = await getDb()
    .update(students)
    .set({ status, archivedAt: status === "archived" ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(students.institutionId, ctx.institution.id), inArray(students.id, valid)))
    .returning({ id: students.id, enrollmentNo: students.enrollmentNo });
  await audit(ctx, { action: "student.bulk_status", entityType: "student", summary: `Set status "${status}" on ${updated.length} student(s)`, metadata: { ids: updated.map((u) => u.enrollmentNo) } });
  return updated.length;
}

export async function existingEnrollments(ctx: TenantContext) {
  const rows = await getDb().select({ e: students.enrollmentNo }).from(students).where(eq(students.institutionId, ctx.institution.id));
  return new Set(rows.map((r) => r.e.toUpperCase()));
}

/** Validate an import file and resolve department/programme/section codes to ids. */
export async function previewImport(ctx: TenantContext, raw: Record<string, string>[]) {
  assertAdminWrite(ctx, "students.import");
  if (raw.length > 5000) throw badRequest("Import files are limited to 5,000 rows.");
  const { valid, issues } = validateImport(raw, await existingEnrollments(ctx));
  const s = await (await import("./academics")).listStructure(ctx);
  const depByCode = new Map(s.departments.map((d) => [d.code.toUpperCase(), d]));
  const progByCode = new Map(s.programmes.map((p) => [p.code.toUpperCase(), p]));
  const resolved: (ImportRow & { row: number; departmentId: string; programmeId: string; sectionId: string | null })[] = [];
  for (const r of valid) {
    const errors: string[] = [];
    const dep = depByCode.get(r.department_code.toUpperCase());
    const prog = progByCode.get(r.programme_code.toUpperCase());
    if (!dep) errors.push(`Unknown department_code "${r.department_code}"`);
    if (!prog) errors.push(`Unknown programme_code "${r.programme_code}"`);
    if (dep && prog && prog.departmentId !== dep.id) errors.push("Programme does not belong to department");
    let sectionId: string | null = null;
    if (r.section && prog) {
      const sec = s.sections.find((x) => x.section.programmeId === prog.id && x.section.semester === r.semester && x.section.name.toUpperCase() === r.section!.toUpperCase() && x.section.academicYear === r.academic_year);
      if (!sec) errors.push(`No section ${r.section} for ${prog.code} sem ${r.semester} ${r.academic_year}`);
      else sectionId = sec.section.id;
    }
    if (errors.length) issues.push({ row: r.row, enrollmentNo: r.enrollment_no, errors });
    else resolved.push({ ...r, departmentId: dep!.id, programmeId: prog!.id, sectionId });
  }
  issues.sort((a, b) => a.row - b.row);
  return { resolved, issues, totalRows: raw.length };
}

export async function commitImport(ctx: TenantContext, raw: Record<string, string>[], fileName: string) {
  const { resolved, issues, totalRows } = await previewImport(ctx, raw);
  if (!resolved.length) return { imported: 0, issues, totalRows };
  await assertCapacity(ctx, resolved.length);
  const db = getDb();
  const imported = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(students)
      .values(
        resolved.map((r) => ({
          institutionId: ctx.institution.id,
          enrollmentNo: r.enrollment_no.toUpperCase(),
          fullName: r.full_name,
          email: r.email ?? null,
          phone: r.phone ?? null,
          dateOfBirth: r.date_of_birth ?? null,
          gender: r.gender ?? null,
          guardianName: r.guardian_name ?? null,
          guardianPhone: r.guardian_phone ?? null,
          bloodGroup: r.blood_group ?? null,
          departmentId: r.departmentId,
          programmeId: r.programmeId,
          sectionId: r.sectionId,
          semester: r.semester,
          academicYear: r.academic_year,
          admissionYear: r.admission_year ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: students.id });
    await audit(ctx, { action: "student.import", entityType: "student", summary: `Imported ${inserted.length} of ${totalRows} rows from ${fileName}`, metadata: { skipped: issues.length } }, tx);
    return inserted.length;
  });
  return { imported, issues, totalRows };
}

export const EXPORT_COLUMNS = ["enrollment_no", "full_name", "email", "phone", "department", "programme", "semester", "section", "academic_year", "status"];
export const EXPORT_SENSITIVE_COLUMNS = ["date_of_birth", "guardian_name", "guardian_phone", "address"];

export async function exportStudents(ctx: TenantContext, query: StudentListQuery) {
  assertCan(ctx, "students.export");
  const rows: Record<string, unknown>[] = [];
  let page = 1;
  for (;;) {
    const res = await listStudents(ctx, { ...query, page, pageSize: 200 });
    for (const r of res.rows)
      rows.push({
        enrollment_no: r.student.enrollmentNo,
        full_name: r.student.fullName,
        email: r.student.email,
        phone: r.student.phone,
        department: r.departmentCode,
        programme: r.programmeCode,
        semester: r.student.semester,
        section: r.sectionName,
        academic_year: r.student.academicYear,
        status: r.student.status,
        date_of_birth: r.student.dateOfBirth,
        guardian_name: r.student.guardianName,
        guardian_phone: r.student.guardianPhone,
        address: r.student.address,
      });
    if (page >= res.pages) break;
    page++;
  }
  const columns = ctx.perms.has("students.view_sensitive") ? [...EXPORT_COLUMNS, ...EXPORT_SENSITIVE_COLUMNS] : EXPORT_COLUMNS;
  await audit(ctx, { action: "student.export", entityType: "student", summary: `Exported ${rows.length} student record(s)`, metadata: { columns } });
  return { rows, columns };
}

/** Create (or link) a login for the student. Returns a one-time password when a new account is made. */
export async function enablePortalAccess(ctx: TenantContext, studentId: string) {
  assertAdminWrite(ctx, "students.portal_access");
  const s = await owned(ctx, students, studentId, "Student");
  if (!s.email) throw badRequest("Add the student's email address before enabling portal access.");
  const db = getDb();
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  return db.transaction(async (tx) => {
    let [u] = await tx.select().from(users).where(eq(users.email, s.email!.toLowerCase())).limit(1);
    let issued: string | null = null;
    if (!u) {
      [u] = await tx.insert(users).values({ email: s.email!.toLowerCase(), name: s.fullName, passwordHash: hash, mustChangePassword: true }).returning();
      issued = tempPassword;
    }
    const [existing] = await tx.select().from(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.institutionId, ctx.institution.id))).limit(1);
    if (existing && existing.role !== "student") throw badRequest("This email already belongs to a staff account in your college.");
    if (existing) await tx.update(memberships).set({ status: "active" }).where(eq(memberships.id, existing.id));
    else await tx.insert(memberships).values({ userId: u.id, institutionId: ctx.institution.id, role: "student" });
    await tx.update(students).set({ userId: u.id }).where(eq(students.id, s.id));
    await audit(ctx, { action: "student.portal_enable", entityType: "student", entityId: s.id, summary: `Enabled portal access for ${s.enrollmentNo}` }, tx);
    return { email: u.email, tempPassword: issued };
  });
}

export async function disablePortalAccess(ctx: TenantContext, studentId: string) {
  assertAdminWrite(ctx, "students.portal_access");
  const s = await owned(ctx, students, studentId, "Student");
  if (!s.userId) return;
  await getDb()
    .update(memberships)
    .set({ status: "disabled" })
    .where(and(eq(memberships.userId, s.userId), eq(memberships.institutionId, ctx.institution.id), eq(memberships.role, "student")));
  await audit(ctx, { action: "student.portal_disable", entityType: "student", entityId: s.id, summary: `Disabled portal access for ${s.enrollmentNo}` });
}

export async function portalAccessStatus(ctx: TenantContext, s: Pick<StudentRow, "userId">) {
  if (!s.userId) return "none" as const;
  const [m] = await getDb()
    .select({ status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.userId, s.userId), eq(memberships.institutionId, ctx.institution.id)))
    .limit(1);
  return (m?.status ?? "none") as "active" | "disabled" | "none";
}

export async function uploadStudentPhoto(ctx: TenantContext, studentId: string, file: File) {
  assertAdminWrite(ctx, "students.edit");
  const s = await owned(ctx, students, studentId, "Student");
  const { buffer, mimeType, name } = await validateUpload(file, "image");
  const key = newStorageKey(ctx.institution.id, "student_photo");
  await storage().put(key, buffer);
  const db = getDb();
  const [f] = await db
    .insert(files)
    .values({ institutionId: ctx.institution.id, ownerType: "student_photo", ownerId: s.id, storageKey: key, originalName: name, mimeType, sizeBytes: buffer.length, uploadedByUserId: ctx.user.id })
    .returning();
  await db.update(students).set({ photoFileId: f.id, updatedAt: new Date() }).where(eq(students.id, s.id));
  await audit(ctx, { action: "student.photo", entityType: "student", entityId: s.id, summary: `Updated photograph for ${s.enrollmentNo}` });
}

export async function uploadStudentDocument(ctx: TenantContext, studentId: string, file: File, label: string) {
  assertAdminWrite(ctx, "students.edit");
  const s = await owned(ctx, students, studentId, "Student");
  if (!label.trim()) throw badRequest("Give the document a label (e.g. 'Bonafide certificate').");
  const { buffer, mimeType, name } = await validateUpload(file, "document");
  const key = newStorageKey(ctx.institution.id, "student_document");
  await storage().put(key, buffer);
  const [f] = await getDb()
    .insert(files)
    .values({ institutionId: ctx.institution.id, ownerType: "student_document", ownerId: s.id, storageKey: key, originalName: name, mimeType, sizeBytes: buffer.length, label: label.trim().slice(0, 120), uploadedByUserId: ctx.user.id })
    .returning();
  await audit(ctx, { action: "student.document_upload", entityType: "student", entityId: s.id, summary: `Uploaded document "${f.label}" for ${s.enrollmentNo}` });
}

export async function studentDocuments(ctx: TenantContext, studentId: string) {
  return getDb()
    .select()
    .from(files)
    .where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "student_document"), eq(files.ownerId, studentId)))
    .orderBy(desc(files.createdAt));
}

export async function studentHistory(ctx: TenantContext, studentId: string) {
  assertCan(ctx, "audit.view");
  return getDb()
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.institutionId, ctx.institution.id), eq(auditLogs.entityId, studentId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(100);
}

export async function studentCountsByDepartment(ctx: TenantContext) {
  return getDb()
    .select({ departmentId: departments.id, code: departments.code, name: departments.name, total: sql<number>`count(${students.id})::int` })
    .from(departments)
    .leftJoin(students, and(eq(students.departmentId, departments.id), eq(students.status, "active")))
    .where(eq(departments.institutionId, ctx.institution.id))
    .groupBy(departments.id)
    .orderBy(asc(departments.code));
}
