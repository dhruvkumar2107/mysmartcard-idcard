import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, files, institutionSettings, portalConfigHistory, supportGrants, users } from "@/db/schema";
import { badRequest } from "@/lib/errors";
import { PERMISSIONS, ROLES, DEFAULT_ROLE_PERMISSIONS, type Role } from "@/lib/permissions";
import { academicSettingsSchema, normalizeConfig, portalConfigSchema, type AcademicSettings, type PortalConfig } from "@/lib/portal-config";
import { newStorageKey, storage, validateUpload } from "@/lib/storage";
import { audit } from "../audit";
import { assertAdminWrite, assertCan, type TenantContext } from "../context";
import { ownedOrNull } from "./guard";

export async function saveDraftConfig(ctx: TenantContext, cfg: PortalConfig) {
  assertAdminWrite(ctx, "portal.configure");
  const parsed = portalConfigSchema.parse(cfg);
  if (parsed.branding.logoFileId) {
    const f = await ownedOrNull(ctx, files, parsed.branding.logoFileId, "Logo");
    if (f?.ownerType !== "branding") throw badRequest("Invalid logo.");
  }
  const normalized = normalizeConfig(parsed, ctx.institution.licensedModules);
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(institutionSettings).set({ draftConfig: normalized, updatedAt: new Date() }).where(eq(institutionSettings.institutionId, ctx.institution.id));
    await tx.insert(portalConfigHistory).values({ institutionId: ctx.institution.id, action: "save_draft", config: normalized, actorUserId: ctx.user.id });
    await audit(ctx, { action: "portal.save_draft", entityType: "portal_config", summary: "Saved portal draft configuration" }, tx);
  });
}

export async function publishConfig(ctx: TenantContext) {
  assertAdminWrite(ctx, "portal.configure");
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(institutionSettings)
      .set({ publishedConfig: ctx.draftConfig, publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(institutionSettings.institutionId, ctx.institution.id));
    await tx.insert(portalConfigHistory).values({ institutionId: ctx.institution.id, action: "publish", config: ctx.draftConfig, actorUserId: ctx.user.id });
    const enabled = Object.entries(ctx.draftConfig.modules).filter(([, m]) => m.enabled).map(([k]) => k);
    await audit(ctx, { action: "portal.publish", entityType: "portal_config", summary: `Published portal configuration (${enabled.length} modules enabled)`, metadata: { enabled, publicFields: ctx.draftConfig.publicFields } }, tx);
  });
}

export async function discardDraft(ctx: TenantContext) {
  assertAdminWrite(ctx, "portal.configure");
  await getDb().update(institutionSettings).set({ draftConfig: ctx.portalConfig }).where(eq(institutionSettings.institutionId, ctx.institution.id));
  await getDb().insert(portalConfigHistory).values({ institutionId: ctx.institution.id, action: "discard", config: ctx.portalConfig, actorUserId: ctx.user.id });
}

export async function configHistory(ctx: TenantContext) {
  assertCan(ctx, "portal.configure");
  return getDb()
    .select({ entry: portalConfigHistory, actor: users.name })
    .from(portalConfigHistory)
    .leftJoin(users, eq(users.id, portalConfigHistory.actorUserId))
    .where(eq(portalConfigHistory.institutionId, ctx.institution.id))
    .orderBy(desc(portalConfigHistory.createdAt))
    .limit(50);
}

export async function uploadLogo(ctx: TenantContext, file: File) {
  assertAdminWrite(ctx, "portal.configure");
  const up = await validateUpload(file, "image");
  const key = newStorageKey(ctx.institution.id, "branding");
  await storage().put(key, up.buffer);
  const [f] = await getDb()
    .insert(files)
    .values({ institutionId: ctx.institution.id, ownerType: "branding", ownerId: ctx.institution.id, storageKey: key, originalName: up.name, mimeType: up.mimeType, sizeBytes: up.buffer.length, uploadedByUserId: ctx.user.id })
    .returning();
  await saveDraftConfig(ctx, { ...ctx.draftConfig, branding: { ...ctx.draftConfig.branding, logoFileId: f.id } });
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
