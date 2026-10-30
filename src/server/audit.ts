import { getDb, type Executor } from "@/db";
import { auditLogs } from "@/db/schema";
import type { TenantContext } from "./context";

export type AuditEntry = {
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

export async function audit(ctx: Pick<TenantContext, "user" | "institution" | "viaSupport"> & { viaPlatform?: boolean }, entry: AuditEntry, tx: Executor = getDb()) {
  await tx.insert(auditLogs).values({
    institutionId: ctx.institution.id,
    actorUserId: ctx.user.id,
    actorName: ctx.viaPlatform ? `${ctx.user.name} (MySmartCard platform)` : ctx.viaSupport ? `${ctx.user.name} (platform support)` : ctx.user.name,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    metadata: entry.metadata ?? null,
  });
}

export async function platformAudit(actor: { id: string; name: string }, entry: AuditEntry & { institutionId?: string | null }, tx: Executor = getDb()) {
  await tx.insert(auditLogs).values({
    institutionId: entry.institutionId ?? null,
    actorUserId: actor.id,
    actorName: actor.name,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    metadata: entry.metadata ?? null,
  });
}
