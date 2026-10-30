import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, institutionSettings, portalConfigHistory, supportGrants, users } from "@/db/schema";
import { badRequest } from "@/lib/errors";
import { PERMISSIONS, ROLES, DEFAULT_ROLE_PERMISSIONS, type Role } from "@/lib/permissions";
import { academicSettingsSchema, normalizeConfig, PUBLIC_FIELDS, type AcademicSettings } from "@/lib/portal-config";
import { audit } from "../audit";
import { assertAdminWrite, assertCan, type TenantContext } from "../context";
import { ownedOrNull } from "./guard";

/**
 * College admins choose which fields the public NFC tap page shows (a privacy decision
 * that belongs to the college). Everything else about the student portal — modules,
 * order, data flags and branding — is owned by the MySmartCard super admin
 * (see services/portal-builder.ts). Applied immediately to draft and published config.
 */
export async function savePublicFields(ctx: TenantContext, fields: string[]) {
  assertAdminWrite(ctx, "portal.configure");
  const publicFields = [...new Set(fields)].filter((f) => PUBLIC_FIELDS.some((p) => p.key === f));
  const db = getDb();
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(institutionSettings).where(eq(institutionSettings.institutionId, ctx.institution.id)).limit(1);
    const lic = ctx.institution.licensedModules;
    const draft = { ...normalizeConfig(row?.draftConfig, lic), publicFields };
    const published = { ...normalizeConfig(row?.publishedConfig, lic), publicFields };
    delete draft.features;
    delete published.features;
    await tx.update(institutionSettings).set({ draftConfig: draft, publishedConfig: published, updatedAt: new Date() }).where(eq(institutionSettings.institutionId, ctx.institution.id));
    await tx.insert(portalConfigHistory).values({ institutionId: ctx.institution.id, action: "public_fields", config: published, actorUserId: ctx.user.id });
    await audit(ctx, { action: "portal.public_fields", entityType: "portal_config", summary: `Updated NFC tap-page fields (${publicFields.length} shown)`, metadata: { publicFields } }, tx);
  });
}

export async function saveAcademicSettings(ctx: TenantContext, settings: AcademicSettings) {
  assertAdminWrite(ctx, "portal.configure");
  const d = academicSettingsSchema.parse(settings);
  const mins = d.gradeScale.map((g) => g.min);
  if (!mins.includes(0)) throw badRequest("The grade scale must include a band starting at 0.");
  if (new Set(mins).size !== mins.length) throw badRequest("Grade bands must have distinct minimum percentages.");
  await getDb().update(institutionSettings).set({ academic: d, updatedAt: new Date() }).where(eq(institutionSettings.institutionId, ctx.institution.id));
  await audit(ctx, { action: "settings.academic", entityType: "institution_settings", summary: `Updated academic rules (attendance threshold ${d.attendanceThreshold}%)`, metadata: d });
}

/** Persist only the differences from the default matrix. college_admin and student are not editable. */
export async function savePermissionOverrides(ctx: TenantContext, granted: Record<string, string[]>) {
  assertAdminWrite(ctx, "users.manage");
  const overrides: Record<string, Record<string, boolean>> = {};
  for (const role of ROLES) {
    if (role === "college_admin" || role === "student") continue;
    const want = new Set(granted[role] ?? []);
    const defaults = new Set(DEFAULT_ROLE_PERMISSIONS[role as Role]);
    for (const perm of Object.keys(PERMISSIONS)) {
      if (want.has(perm) !== defaults.has(perm as never)) (overrides[role] ??= {})[perm] = want.has(perm);
    }
  }
  await getDb().update(institutionSettings).set({ permissionOverrides: overrides, updatedAt: new Date() }).where(eq(institutionSettings.institutionId, ctx.institution.id));
  await audit(ctx, { action: "permissions.update", entityType: "institution_settings", summary: "Updated role permissions", metadata: { overrides } });
}

export async function grantSupport(ctx: TenantContext, hours: number, reason: string) {
  assertAdminWrite(ctx, "support.grant");
  if (!(hours >= 1 && hours <= 72)) throw badRequest("Support access can be granted for 1–72 hours.");
  if (reason.trim().length < 5) throw badRequest("Describe why support needs access.");
  const [g] = await getDb()
    .insert(supportGrants)
    .values({ institutionId: ctx.institution.id, grantedByUserId: ctx.user.id, reason: reason.trim(), expiresAt: new Date(Date.now() + hours * 36e5) })
    .returning();
  await audit(ctx, { action: "support.grant", entityType: "support_grant", entityId: g.id, summary: `Granted platform support read-only access for ${hours}h: ${reason.trim()}` });
}

export async function revokeSupport(ctx: TenantContext, id: string) {
  assertAdminWrite(ctx, "support.grant");
  const g = await ownedOrNull(ctx, supportGrants, id, "Grant");
  if (!g) return;
  await getDb().update(supportGrants).set({ revokedAt: new Date() }).where(eq(supportGrants.id, g.id));
  await audit(ctx, { action: "support.revoke", entityType: "support_grant", entityId: g.id, summary: "Revoked platform support access" });
}

export async function supportGrantsFor(ctx: TenantContext) {
  assertCan(ctx, "support.grant");
  return getDb()
    .select({ grant: supportGrants, grantedBy: users.name, active: sql<boolean>`${supportGrants.expiresAt} > now() and ${supportGrants.revokedAt} is null` })
    .from(supportGrants)
    .leftJoin(users, eq(users.id, supportGrants.grantedByUserId))
    .where(eq(supportGrants.institutionId, ctx.institution.id))
    .orderBy(desc(supportGrants.createdAt))
    .limit(20);
}

export async function hasActiveSupportGrant(institutionId: string) {
  const [g] = await getDb()
    .select({ id: supportGrants.id })
    .from(supportGrants)
    .where(and(eq(supportGrants.institutionId, institutionId), gt(supportGrants.expiresAt, new Date()), isNull(supportGrants.revokedAt)))
    .limit(1);
  return !!g;
}

export async function auditLog(ctx: TenantContext, filter: { entityType?: string; q?: string; page?: number }) {
  assertCan(ctx, "audit.view");
  const conds = [eq(auditLogs.institutionId, ctx.institution.id)];
  if (filter.entityType) conds.push(eq(auditLogs.entityType, filter.entityType));
  if (filter.q?.trim()) conds.push(sql`${auditLogs.summary} ilike ${"%" + filter.q.trim() + "%"}`);
  const page = Math.max(1, filter.page ?? 1);
  return getDb()
    .select()
    .from(auditLogs)
    .where(and(...conds))
    .orderBy(desc(auditLogs.createdAt))
    .limit(50)
    .offset((page - 1) * 50);
}
