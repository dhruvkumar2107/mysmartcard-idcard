import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Executor } from "@/db";
import { files, institutions, institutionSettings, platformSettings, portalPolicyHistory, users } from "@/db/schema";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import {
  FLAG_KEYS,
  MODULE_KEYS,
  normalizeConfig,
  normalizePolicy,
  portalConfigSchema,
  portalPolicySchema,
  resolvePolicy,
  type Branding,
  type PortalPolicy,
} from "@/lib/portal-config";
import { newStorageKey, storage, validateUpload } from "@/lib/storage";
import { platformAudit } from "../audit";
import { GLOBAL_POLICY_KEYS, loadGlobalPolicy } from "../context";

/**
 * Super-admin Portal Builder. Two layers of policy:
 *   - global defaults (platform_settings), applied to every college;
 *   - per-college overrides (institution_settings.policy_*), holding only explicit choices.
 * Both have a draft and a published version; students only ever see published layers.
 * College admins have no write path into any of this — every function asserts the super admin.
 */

type Actor = { id: string; name: string; isSuperAdmin: boolean };
const assertSuper = (a: Actor) => {
  if (!a.isSuperAdmin) throw forbidden("Only the MySmartCard super admin can change the student portal.");
};

const brandingSchema = portalConfigSchema.shape.branding;

async function settingsRow(institutionId: string, tx: Executor = getDb()) {
  const [row] = await tx
    .select({ settings: institutionSettings, inst: institutions })
    .from(institutionSettings)
    .innerJoin(institutions, eq(institutions.id, institutionSettings.institutionId))
    .where(eq(institutionSettings.institutionId, institutionId))
    .limit(1);
  if (!row) throw notFound("College");
  return row;
}

async function setPlatformSetting(key: string, value: unknown, actor: Actor, tx: Executor) {
  await tx
    .insert(platformSettings)
    .values({ key, value, updatedByUserId: actor.id })
    .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedByUserId: actor.id, updatedAt: new Date() } });
}

// ---------------------------------------------------------------- Reading

export async function globalPolicyState(actor: Actor) {
  assertSuper(actor);
  const g = await loadGlobalPolicy();
  return { ...g, resolvedDraft: resolvePolicy(g.draft), resolvedPublished: resolvePolicy(g.published), dirty: JSON.stringify(g.draft) !== JSON.stringify(g.published) };
}

export async function collegePolicyState(actor: Actor, institutionId: string) {
  assertSuper(actor);
  const { settings, inst } = await settingsRow(institutionId);
  const g = await loadGlobalPolicy();
  const draft = normalizePolicy(settings.policyDraft);
  const published = normalizePolicy(settings.policyPublished);
  const draftCfg = normalizeConfig(settings.draftConfig, inst.licensedModules);
  const publishedCfg = normalizeConfig(settings.publishedConfig, inst.licensedModules);
  return {
    institution: inst,
    defaults: resolvePolicy(g.published),
    draft,
    published,
    resolvedDraft: resolvePolicy(g.published, draft),
    resolvedPublished: resolvePolicy(g.published, published),
    branding: { draft: draftCfg.branding, published: publishedCfg.branding },
    publishedAt: settings.policyPublishedAt,
    dirty: JSON.stringify(draft) !== JSON.stringify(published) || JSON.stringify(draftCfg.branding) !== JSON.stringify(publishedCfg.branding),
  };
}

export async function policyHistory(actor: Actor, institutionId: string | null, limit = 40) {
  assertSuper(actor);
  return getDb()
    .select({ entry: portalPolicyHistory, actor: users.name })
    .from(portalPolicyHistory)
    .leftJoin(users, eq(users.id, portalPolicyHistory.actorUserId))
    .where(institutionId ? eq(portalPolicyHistory.institutionId, institutionId) : isNull(portalPolicyHistory.institutionId))
    .orderBy(desc(portalPolicyHistory.createdAt))
    .limit(limit);
}

// ---------------------------------------------------------------- Global defaults

export async function saveGlobalDraft(actor: Actor, input: PortalPolicy) {
  assertSuper(actor);
  const policy = completePolicy(normalizePolicy(portalPolicySchema.parse(input)));
  await getDb().transaction(async (tx) => {
    await setPlatformSetting(GLOBAL_POLICY_KEYS.draft, policy, actor, tx);
    await tx.insert(portalPolicyHistory).values({ institutionId: null, action: "save_draft", policy, actorUserId: actor.id });
    await platformAudit(actor, { action: "portal_defaults.save_draft", entityType: "portal_policy", summary: "Saved draft of global student-portal defaults", metadata: { policy } }, tx);
  });
}

export async function publishGlobal(actor: Actor) {
  assertSuper(actor);
  const g = await loadGlobalPolicy();
  await getDb().transaction(async (tx) => {
    await setPlatformSetting(GLOBAL_POLICY_KEYS.published, g.draft, actor, tx);
    await setPlatformSetting(GLOBAL_POLICY_KEYS.draft, g.draft, actor, tx);
    await tx.insert(portalPolicyHistory).values({ institutionId: null, action: "publish", policy: g.draft, actorUserId: actor.id });
    await platformAudit(actor, { action: "portal_defaults.publish", entityType: "portal_policy", summary: `Published global student-portal defaults (${enabledFlags(g.draft)})`, metadata: { policy: g.draft } }, tx);
  });
}

export async function discardGlobalDraft(actor: Actor) {
  assertSuper(actor);
  const g = await loadGlobalPolicy();
  await getDb().transaction(async (tx) => {
    await setPlatformSetting(GLOBAL_POLICY_KEYS.draft, g.published, actor, tx);
    await tx.insert(portalPolicyHistory).values({ institutionId: null, action: "discard", policy: g.published, actorUserId: actor.id });
  });
}

// ---------------------------------------------------------------- College overrides

export async function saveCollegeDraft(actor: Actor, institutionId: string, input: PortalPolicy, branding?: Omit<Branding, "logoFileId">) {
  assertSuper(actor);
  const policy = normalizePolicy(portalPolicySchema.parse(input));
  await getDb().transaction(async (tx) => {
    const { settings, inst } = await settingsRow(institutionId, tx);
    const cfg = normalizeConfig(settings.draftConfig, inst.licensedModules);
    if (branding) cfg.branding = brandingSchema.parse({ ...branding, logoFileId: cfg.branding.logoFileId });
    await tx.update(institutionSettings).set({ policyDraft: policy, draftConfig: stripFeatures(cfg), updatedAt: new Date() }).where(eq(institutionSettings.institutionId, inst.id));
    await tx.insert(portalPolicyHistory).values({ institutionId: inst.id, action: "save_draft", policy, branding: cfg.branding, actorUserId: actor.id });
    await platformAudit(actor, { institutionId: inst.id, action: "portal.save_draft", entityType: "portal_policy", summary: `Saved student-portal draft for ${inst.name}`, metadata: { policy } }, tx);
  });
}

export async function publishCollege(actor: Actor, institutionId: string) {
  assertSuper(actor);
  await getDb().transaction(async (tx) => {
    const { settings, inst } = await settingsRow(institutionId, tx);
    const draftCfg = normalizeConfig(settings.draftConfig, inst.licensedModules);
    const pubCfg = normalizeConfig(settings.publishedConfig, inst.licensedModules);
    // Branding comes from the draft; the college admin's public-field choices are kept as published.
    const nextPublished = stripFeatures({ ...pubCfg, branding: draftCfg.branding });
    const policy = normalizePolicy(settings.policyDraft);
    await tx
      .update(institutionSettings)
      .set({ policyPublished: policy, policyPublishedAt: new Date(), publishedConfig: nextPublished, publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(institutionSettings.institutionId, inst.id));
    await tx.insert(portalPolicyHistory).values({ institutionId: inst.id, action: "publish", policy, branding: draftCfg.branding, actorUserId: actor.id });
    await platformAudit(actor, { institutionId: inst.id, action: "portal.publish", entityType: "portal_policy", summary: `Published student portal for ${inst.name} (overrides: ${enabledFlags(policy)})`, metadata: { policy } }, tx);
  });
}

export async function discardCollegeDraft(actor: Actor, institutionId: string) {
  assertSuper(actor);
  await getDb().transaction(async (tx) => {
    const { settings, inst } = await settingsRow(institutionId, tx);
    const pubCfg = normalizeConfig(settings.publishedConfig, inst.licensedModules);
    const draftCfg = normalizeConfig(settings.draftConfig, inst.licensedModules);
    const policy = normalizePolicy(settings.policyPublished);
    await tx.update(institutionSettings).set({ policyDraft: policy, draftConfig: stripFeatures({ ...draftCfg, branding: pubCfg.branding }) }).where(eq(institutionSettings.institutionId, inst.id));
    await tx.insert(portalPolicyHistory).values({ institutionId: inst.id, action: "discard", policy, branding: pubCfg.branding, actorUserId: actor.id });
  });
}

/** Restore an earlier version as both draft and published (audited). */
export async function rollbackTo(actor: Actor, historyId: string) {
  assertSuper(actor);
  if (!z.uuid().safeParse(historyId).success) throw notFound("Version");
  const [h] = await getDb().select().from(portalPolicyHistory).where(eq(portalPolicyHistory.id, historyId)).limit(1);
  if (!h) throw notFound("Version");
  const policy = normalizePolicy(h.policy);
  if (!h.institutionId) {
    const complete = completePolicy(policy);
    await getDb().transaction(async (tx) => {
      await setPlatformSetting(GLOBAL_POLICY_KEYS.published, complete, actor, tx);
      await setPlatformSetting(GLOBAL_POLICY_KEYS.draft, complete, actor, tx);
      await tx.insert(portalPolicyHistory).values({ institutionId: null, action: "rollback", policy: complete, actorUserId: actor.id });
      await platformAudit(actor, { action: "portal_defaults.rollback", entityType: "portal_policy", entityId: h.id, summary: "Rolled back global student-portal defaults", metadata: { policy: complete } }, tx);
    });
    return null;
  }
  const institutionId = h.institutionId;
  await getDb().transaction(async (tx) => {
    const { settings, inst } = await settingsRow(institutionId, tx);
    const pub = normalizeConfig(settings.publishedConfig, inst.licensedModules);
    const draft = normalizeConfig(settings.draftConfig, inst.licensedModules);
    const branding = h.branding ? brandingSchema.safeParse(h.branding) : null;
    const b = branding?.success ? branding.data : pub.branding;
    await tx
      .update(institutionSettings)
      .set({ policyDraft: policy, policyPublished: policy, policyPublishedAt: new Date(), publishedConfig: stripFeatures({ ...pub, branding: b }), draftConfig: stripFeatures({ ...draft, branding: b }), publishedAt: new Date() })
      .where(eq(institutionSettings.institutionId, inst.id));
    await tx.insert(portalPolicyHistory).values({ institutionId: inst.id, action: "rollback", policy, branding: b, actorUserId: actor.id });
    await platformAudit(actor, { institutionId: inst.id, action: "portal.rollback", entityType: "portal_policy", entityId: h.id, summary: `Rolled back student portal for ${inst.name}`, metadata: { policy } }, tx);
  });
  return institutionId;
}

export async function uploadCollegeLogo(actor: Actor, institutionId: string, file: File) {
  assertSuper(actor);
  const up = await validateUpload(file, "image");
  const { settings, inst } = await settingsRow(institutionId);
  const key = newStorageKey(inst.id, "branding");
  await storage().put(key, up.buffer);
  await getDb().transaction(async (tx) => {
    const [f] = await tx
      .insert(files)
      .values({ institutionId: inst.id, ownerType: "branding", ownerId: inst.id, storageKey: key, originalName: up.name, mimeType: up.mimeType, sizeBytes: up.buffer.length, uploadedByUserId: actor.id })
      .returning();
    const cfg = normalizeConfig(settings.draftConfig, inst.licensedModules);
    cfg.branding.logoFileId = f.id;
    await tx.update(institutionSettings).set({ draftConfig: stripFeatures(cfg) }).where(eq(institutionSettings.institutionId, inst.id));
    await platformAudit(actor, { institutionId: inst.id, action: "portal.logo", entityType: "portal_policy", summary: `Uploaded a new logo for ${inst.name} (draft)` }, tx);
  });
}

// ---------------------------------------------------------------- Helpers

/** Global defaults are stored complete, so every key has an explicit value. */
function completePolicy(p: PortalPolicy): PortalPolicy {
  const r = resolvePolicy(p);
  return {
    modules: Object.fromEntries(MODULE_KEYS.map((k) => [k, { enabled: p.modules[k]?.enabled ?? r.modules[k].enabled, order: r.modules[k].order }])),
    features: Object.fromEntries(FLAG_KEYS.map((f) => [f, r.features[f]])),
  };
}

function stripFeatures<T extends { features?: unknown }>(cfg: T): Omit<T, "features"> {
  const { features: _f, ...rest } = cfg;
  void _f;
  return rest;
}

function enabledFlags(p: PortalPolicy) {
  const on = FLAG_KEYS.filter((f) => p.features[f] === true);
  const off = FLAG_KEYS.filter((f) => p.features[f] === false);
  return [on.length ? `on: ${on.join(", ")}` : "", off.length ? `off: ${off.join(", ")}` : ""].filter(Boolean).join("; ") || "no flag overrides";
}

/** Parse the builder form: each key is "inherit" | "on" | "off" (college) or "on" | "off" (global). */
export function policyFromForm(fd: FormData): PortalPolicy {
  const tri = (v: FormDataEntryValue | null) => (v === "on" ? true : v === "off" ? false : undefined);
  const policy: PortalPolicy = { modules: {}, features: {} };
  for (const k of MODULE_KEYS) {
    const enabled = tri(fd.get(`mod_${k}`));
    const rawOrder = String(fd.get(`order_${k}`) ?? "").trim();
    const order = rawOrder === "" ? undefined : Number(rawOrder);
    if (order !== undefined && !(Number.isInteger(order) && order >= 0 && order <= 100)) throw badRequest("Section order must be a whole number from 0 to 100.");
    if (enabled !== undefined || order !== undefined) policy.modules[k] = { ...(enabled !== undefined && { enabled }), ...(order !== undefined && { order }) };
  }
  for (const f of FLAG_KEYS) {
    const v = tri(fd.get(`flag_${f}`));
    if (v !== undefined) policy.features[f] = v;
  }
  return policy;
}

/** Colleges that explicitly override a given flag (shown next to global defaults). */
export async function overrideCounts(actor: Actor) {
  assertSuper(actor);
  const rows = await getDb().select({ id: institutionSettings.institutionId, p: institutionSettings.policyPublished }).from(institutionSettings);
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const p = normalizePolicy(r.p);
    for (const f of Object.keys(p.features)) counts[f] = (counts[f] ?? 0) + 1;
    for (const k of Object.keys(p.modules)) counts[`mod:${k}`] = (counts[`mod:${k}`] ?? 0) + 1;
  }
  return counts;
}

