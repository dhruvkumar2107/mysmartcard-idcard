import { and, eq, gt, isNull, inArray, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { classAssignments, faculty, institutions, institutionSettings, memberships, students, supportGrants } from "@/db/schema";
import { forbidden, notFound } from "@/lib/errors";
import { isRole, resolvePermissions, scopeForRole, type DataScope, type Permission, type Role } from "@/lib/permissions";
import { normalizeAcademic, normalizeConfig, type AcademicSettings, type PortalConfig } from "@/lib/portal-config";
import type { SessionUser } from "./auth";

export type Institution = typeof institutions.$inferSelect;

export type TenantContext = {
  user: Pick<SessionUser, "id" | "name" | "email" | "isSuperAdmin">;
  institution: Institution;
  role: Role;
  departmentId: string | null;
  perms: Set<Permission>;
  scope: DataScope;
  /** Present for faculty / HOD accounts linked to a faculty record. */
  facultyId: string | null;
  /** Teaching assignments of the faculty record (empty otherwise). */
  classes: { id: string; subjectId: string; sectionId: string }[];
  /** Present for student accounts. */
  studentId: string | null;
  /** Super admin acting under a college-issued support grant (read-only). */
  viaSupport: boolean;
  portalConfig: PortalConfig;
  draftConfig: PortalConfig;
  academic: AcademicSettings;
  permissionOverrides: Record<string, Record<string, boolean>>;
};

const SUPPORT_PERMISSIONS: Permission[] = ["dashboard.view", "reports.view", "students.view", "faculty.view", "attendance.view_all", "audit.view"];

/**
 * Resolve the caller's rights inside a college. This is THE tenant boundary:
 * every service function receives the context produced here and scopes its
 * queries by `ctx.institution.id`.
 */
export async function loadTenantContext(user: TenantContext["user"], slug: string): Promise<TenantContext> {
  const db = getDb();
  const [inst] = await db.select().from(institutions).where(eq(institutions.slug, slug)).limit(1);
  if (!inst) throw notFound("College");
  if (inst.status !== "active" && !user.isSuperAdmin) throw forbidden("This college workspace is currently suspended.");

  const [settings] = await db.select().from(institutionSettings).where(eq(institutionSettings.institutionId, inst.id)).limit(1);
  const overrides = (settings?.permissionOverrides ?? {}) as Record<string, Record<string, boolean>>;
  const base = {
    user: { id: user.id, name: user.name, email: user.email, isSuperAdmin: user.isSuperAdmin },
    institution: inst,
    portalConfig: normalizeConfig(settings?.publishedConfig, inst.licensedModules),
    draftConfig: normalizeConfig(settings?.draftConfig, inst.licensedModules),
    academic: normalizeAcademic(settings?.academic),
    permissionOverrides: overrides,
  };

  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.institutionId, inst.id), eq(memberships.status, "active")))
    .limit(1);

  if (!m) {
    if (user.isSuperAdmin) {
      const [grant] = await db
        .select({ id: supportGrants.id })
        .from(supportGrants)
        .where(and(eq(supportGrants.institutionId, inst.id), gt(supportGrants.expiresAt, new Date()), isNull(supportGrants.revokedAt)))
        .limit(1);
      if (grant) {
        return {
          ...base,
          role: "college_admin",
          departmentId: null,
          perms: new Set(SUPPORT_PERMISSIONS),
          scope: { kind: "all" },
          facultyId: null,
          classes: [],
          studentId: null,
          viaSupport: true,
        };
      }
    }
    throw forbidden("You are not a member of this college.");
  }
  if (!isRole(m.role)) throw forbidden("Unknown role.");

  let facultyId: string | null = null;
  let classes: TenantContext["classes"] = [];
  let studentId: string | null = null;
  if (m.role === "student") {
    const [s] = await db
      .select({ id: students.id, status: students.status })
      .from(students)
      .where(and(eq(students.userId, user.id), eq(students.institutionId, inst.id)))
      .limit(1);
    if (!s || s.status === "archived") throw forbidden("Your student portal access is not active.");
    studentId = s.id;
  } else {
    const [f] = await db
      .select({ id: faculty.id })
      .from(faculty)
      .where(and(eq(faculty.userId, user.id), eq(faculty.institutionId, inst.id)))
      .limit(1);
    if (f) {
      facultyId = f.id;
      classes = await db
        .select({ id: classAssignments.id, subjectId: classAssignments.subjectId, sectionId: classAssignments.sectionId })
        .from(classAssignments)
        .where(and(eq(classAssignments.facultyId, f.id), eq(classAssignments.institutionId, inst.id)));
    }
  }

  return {
    ...base,
    role: m.role,
    departmentId: m.departmentId,
    perms: resolvePermissions(m.role, overrides),
    scope: scopeForRole(m.role, m.departmentId),
    facultyId,
    classes,
    studentId,
    viaSupport: false,
  };
}

export function can(ctx: TenantContext, perm: Permission) {
  return ctx.perms.has(perm);
}

export function assertCan(ctx: TenantContext, perm: Permission) {
  if (!ctx.perms.has(perm)) throw forbidden();
}

/** Read-only support sessions may never mutate data. */
export function assertWritable(ctx: TenantContext) {
  if (ctx.viaSupport) throw forbidden("Support access is read-only.");
}

export function assertAdminWrite(ctx: TenantContext, perm: Permission) {
  assertWritable(ctx);
  assertCan(ctx, perm);
}

/** SQL condition restricting the students table to what the caller may see. */
export function studentScope(ctx: TenantContext): SQL {
  const inst = eq(students.institutionId, ctx.institution.id);
  switch (ctx.scope.kind) {
    case "all":
      return inst;
    case "department":
      return ctx.scope.departmentId ? and(inst, eq(students.departmentId, ctx.scope.departmentId))! : sql`false`;
    case "classes": {
      const sectionIds = [...new Set(ctx.classes.map((c) => c.sectionId))];
      return sectionIds.length ? and(inst, inArray(students.sectionId, sectionIds))! : sql`false`;
    }
  }
}

/** Whether the caller teaches this subject+section (or has institution-wide rights). */
export function teaches(ctx: TenantContext, subjectId: string, sectionId: string) {
  return ctx.classes.some((c) => c.subjectId === subjectId && c.sectionId === sectionId);
}
