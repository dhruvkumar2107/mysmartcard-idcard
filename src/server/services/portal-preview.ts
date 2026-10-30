import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { institutions, institutionSettings } from "@/db/schema";
import { forbidden, notFound } from "@/lib/errors";
import { applyPolicy, normalizeConfig, normalizePolicy, resolvePolicy, type PortalConfig } from "@/lib/portal-config";
import { loadGlobalPolicy, loadTenantContext, type TenantContext } from "../context";
import { isUuid } from "./guard";

export type PreviewLayer = "college" | "global";

/**
 * Super-admin preview context for a college plus the configuration to render:
 *  - "college": the college's DRAFT override on top of the published global defaults;
 *  - "global":  the DRAFT global defaults with the college's published override.
 */
export async function platformPreviewContext(user: TenantContext["user"], collegeId: string, layer: PreviewLayer): Promise<{ ctx: TenantContext; config: PortalConfig }> {
  if (!user.isSuperAdmin) throw forbidden();
  if (!isUuid(collegeId)) throw notFound("College");
  const [row] = await getDb().select({ inst: institutions, settings: institutionSettings }).from(institutions).innerJoin(institutionSettings, eq(institutionSettings.institutionId, institutions.id)).where(eq(institutions.id, collegeId)).limit(1);
  if (!row) throw notFound("College");
  const ctx = await loadTenantContext(user, row.inst.slug);
  if (layer === "college") return { ctx, config: ctx.draftConfig };
  const g = await loadGlobalPolicy();
  const lic = row.inst.licensedModules;
  return { ctx, config: applyPolicy(normalizeConfig(row.settings.draftConfig, lic), resolvePolicy(g.draft, normalizePolicy(row.settings.policyPublished)), lic) };
}
