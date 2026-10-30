import { and, desc, eq, ne, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { departments, files, programmes, sections, timetableImages, users } from "@/db/schema";
import { badRequest } from "@/lib/errors";
import { newStorageKey, storage, validateUpload } from "@/lib/storage";
import { audit } from "../audit";
import { assertAdminWrite, assertCan, type TenantContext } from "../context";
import { owned, ownedOrNull } from "./guard";

/**
 * Timetables are uploaded as images (JPG/PNG/WebP) instead of typed period-by-period.
 * Every version of the image is kept in `files` (owner_type = timetable_image) for history;
 * `timetable_images.file_id` points at the current one.
 */

export const TIMETABLE_KINDS = [
  { key: "class", label: "Class timetable" },
  { key: "exam", label: "Examination timetable" },
] as const;

const meta = z.object({
  title: z.string().trim().min(2).max(160),
  kind: z.enum(["class", "exam"]),
  departmentId: z.string().nullable(),
  programmeId: z.string().nullable(),
  semester: z.number().int().min(1).max(12).nullable(),
  sectionId: z.string().nullable(),
  academicYear: z.string().trim().max(20).nullable(),
});
export type TimetableMeta = z.input<typeof meta>;

/** Validate targeting ids belong to this college and are mutually consistent. */
async function checkTargets(ctx: TenantContext, d: z.infer<typeof meta>) {
  const dep = await ownedOrNull(ctx, departments, d.departmentId, "Department");
  const prog = await ownedOrNull(ctx, programmes, d.programmeId, "Programme");
  const sec = await ownedOrNull(ctx, sections, d.sectionId, "Section");
  if (prog && dep && prog.departmentId !== dep.id) throw badRequest("That programme is not in the selected department.");
  if (sec && prog && sec.programmeId !== prog.id) throw badRequest("That section is not in the selected programme.");
  if (sec && d.semester && sec.semester !== d.semester) throw badRequest("That section is not in the selected semester.");
  // A section implies its programme, department and semester.
  if (sec) {
    const p = prog ?? (await owned(ctx, programmes, sec.programmeId, "Programme"));
    return { departmentId: p.departmentId, programmeId: p.id, semester: sec.semester, sectionId: sec.id };
  }
  if (prog) return { departmentId: prog.departmentId, programmeId: prog.id, semester: d.semester, sectionId: null };
  return { departmentId: dep?.id ?? null, programmeId: null, semester: d.semester, sectionId: null };
}

async function storeImage(ctx: TenantContext, ownerId: string | null, file: File) {
  const up = await validateUpload(file, "photo");
  const key = newStorageKey(ctx.institution.id, "timetable_image");
  await storage().put(key, up.buffer);
  const [f] = await getDb()
    .insert(files)
    .values({ institutionId: ctx.institution.id, ownerType: "timetable_image", ownerId, storageKey: key, originalName: up.name, mimeType: up.mimeType, sizeBytes: up.buffer.length, uploadedByUserId: ctx.user.id })
    .returning();
  return f;
}

export async function createTimetableImage(ctx: TenantContext, input: TimetableMeta, file: File | null, publish: boolean) {
  assertAdminWrite(ctx, "timetable.manage");
  const d = meta.parse(input);
  if (!file || file.size === 0) throw badRequest("Choose a timetable image to upload.");
  const targets = await checkTargets(ctx, d);
  const f = await storeImage(ctx, null, file);
  const [row] = await getDb()
    .insert(timetableImages)
    .values({ institutionId: ctx.institution.id, title: d.title, kind: d.kind, academicYear: d.academicYear || null, ...targets, fileId: f.id, status: publish ? "published" : "draft", publishedAt: publish ? new Date() : null, createdByUserId: ctx.user.id, updatedByUserId: ctx.user.id })
    .returning();
  await getDb().update(files).set({ ownerId: row.id }).where(eq(files.id, f.id));
  await audit(ctx, { action: "timetable_image.upload", entityType: "timetable_image", entityId: row.id, summary: `Uploaded ${d.kind} timetable "${d.title}"${publish ? " and published it" : " as draft"}` });
  return row;
}

export async function updateTimetableImage(ctx: TenantContext, id: string, input: TimetableMeta, replacement: File | null) {
  assertAdminWrite(ctx, "timetable.manage");
  const t = await owned(ctx, timetableImages, id, "Timetable");
  const d = meta.parse(input);
  const targets = await checkTargets(ctx, d);
  const f = replacement && replacement.size > 0 ? await storeImage(ctx, t.id, replacement) : null;
  await getDb()
    .update(timetableImages)
    .set({ title: d.title, kind: d.kind, academicYear: d.academicYear || null, ...targets, ...(f && { fileId: f.id }), updatedByUserId: ctx.user.id, updatedAt: new Date() })
    .where(and(eq(timetableImages.id, t.id), eq(timetableImages.institutionId, ctx.institution.id)));
  await audit(ctx, { action: f ? "timetable_image.replace" : "timetable_image.update", entityType: "timetable_image", entityId: t.id, summary: `${f ? "Replaced the image of" : "Updated details of"} timetable "${d.title}"` });
}

export async function setTimetableImageStatus(ctx: TenantContext, id: string, action: "publish" | "unpublish" | "archive" | "restore" | "delete") {
  assertAdminWrite(ctx, "timetable.manage");
  const t = await owned(ctx, timetableImages, id, "Timetable");
  const where = and(eq(timetableImages.id, t.id), eq(timetableImages.institutionId, ctx.institution.id));
  const db = getDb();
  if (action === "delete") {
    const versions = await db.select().from(files).where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "timetable_image"), eq(files.ownerId, t.id)));
    await db.delete(timetableImages).where(where);
    await db.delete(files).where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "timetable_image"), eq(files.ownerId, t.id)));
    await Promise.all(versions.map((v) => storage().remove(v.storageKey)));
  } else {
    const status = action === "publish" ? "published" : action === "archive" ? "archived" : "draft";
    await db
      .update(timetableImages)
      .set({ status, ...(action === "publish" && { publishedAt: new Date() }), updatedByUserId: ctx.user.id, updatedAt: new Date() })
      .where(where);
  }
  await audit(ctx, { action: `timetable_image.${action}`, entityType: "timetable_image", entityId: t.id, summary: `${action} timetable "${t.title}"` });
}

export async function listTimetableImages(ctx: TenantContext, opts: { archived?: boolean } = {}) {
  const conds: SQL[] = [eq(timetableImages.institutionId, ctx.institution.id)];
  conds.push(opts.archived ? eq(timetableImages.status, "archived") : ne(timetableImages.status, "archived"));
  // Staff without timetable.manage only see what students see.
  if (!ctx.perms.has("timetable.manage")) conds.push(eq(timetableImages.status, "published"));
  return getDb()
    .select({ t: timetableImages, file: files, department: departments.code, programme: programmes.code, section: sections.name, updatedBy: users.name })
    .from(timetableImages)
    .innerJoin(files, eq(files.id, timetableImages.fileId))
    .leftJoin(departments, eq(departments.id, timetableImages.departmentId))
    .leftJoin(programmes, eq(programmes.id, timetableImages.programmeId))
    .leftJoin(sections, eq(sections.id, timetableImages.sectionId))
    .leftJoin(users, eq(users.id, timetableImages.updatedByUserId))
    .where(and(...conds))
    .orderBy(desc(timetableImages.updatedAt));
}

export async function timetableImage(ctx: TenantContext, id: string) {
  assertCan(ctx, "timetable.manage");
  const t = await owned(ctx, timetableImages, id, "Timetable");
  const versions = await getDb()
    .select({ file: files, uploadedBy: users.name })
    .from(files)
    .leftJoin(users, eq(users.id, files.uploadedByUserId))
    .where(and(eq(files.institutionId, ctx.institution.id), eq(files.ownerType, "timetable_image"), eq(files.ownerId, t.id)))
    .orderBy(desc(files.createdAt));
  return { t, versions };
}

/** Pure match: every non-null target must equal the student's value. */
export function timetableTargetsStudent(
  t: Pick<typeof timetableImages.$inferSelect, "departmentId" | "programmeId" | "semester" | "sectionId" | "academicYear">,
  s: { departmentId: string | null; programmeId: string | null; semester: number; sectionId: string | null; academicYear: string },
) {
  if (t.departmentId && t.departmentId !== s.departmentId) return false;
  if (t.programmeId && t.programmeId !== s.programmeId) return false;
  if (t.semester && t.semester !== s.semester) return false;
  if (t.sectionId && t.sectionId !== s.sectionId) return false;
  if (t.academicYear && t.academicYear !== s.academicYear) return false;
  return true;
}

/** Published timetables that apply to this student, most specific first. */
export async function timetableImagesForStudent(ctx: Pick<TenantContext, "institution">, s: Parameters<typeof timetableTargetsStudent>[1]) {
  const rows = await getDb()
    .select({ t: timetableImages, file: { id: files.id, name: files.originalName, mimeType: files.mimeType, size: files.sizeBytes } })
    .from(timetableImages)
    .innerJoin(files, eq(files.id, timetableImages.fileId))
    .where(and(eq(timetableImages.institutionId, ctx.institution.id), eq(timetableImages.status, "published")));
  const specificity = (t: typeof timetableImages.$inferSelect) => [t.sectionId, t.semester, t.programmeId, t.departmentId].filter((x) => x !== null).length;
  return rows
    .filter((r) => timetableTargetsStudent(r.t, s))
    .sort((a, b) => (a.t.kind === b.t.kind ? specificity(b.t) - specificity(a.t) || (b.t.publishedAt?.getTime() ?? 0) - (a.t.publishedAt?.getTime() ?? 0) : a.t.kind === "class" ? -1 : 1));
}

/** For /api/files authorization: may this context download this timetable version? */
export async function canViewTimetableFile(ctx: TenantContext, file: { id: string; ownerId: string | null }, student: Parameters<typeof timetableTargetsStudent>[1] | null) {
  const ownerId = file.ownerId;
  if (!ownerId) return false;
  const [t] = await getDb().select().from(timetableImages).where(and(eq(timetableImages.id, ownerId), eq(timetableImages.institutionId, ctx.institution.id))).limit(1);
  if (!t) return false;
  // Students get only the current image of a published timetable that applies to them; earlier versions are staff-only.
  if (student) return t.status === "published" && t.fileId === file.id && timetableTargetsStudent(t, student);
  return ctx.perms.has("timetable.manage") || (t.status === "published" && t.fileId === file.id);
}

