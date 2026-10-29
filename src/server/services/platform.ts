import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ref } from "@/db/sql";
import { getDb } from "@/db";
import { auditLogs, institutions, institutionSettings, memberships, nfcCards, sessions, students, supportGrants, users, faculty } from "@/db/schema";
import { generateTempPassword } from "@/lib/crypto";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { DEFAULT_ACADEMIC, defaultPortalConfig, MODULE_KEYS } from "@/lib/portal-config";
import { storage, storageBackend } from "@/lib/storage";
import { hashPassword } from "../auth";
import { platformAudit } from "../audit";

type Actor = { id: string; name: string; isSuperAdmin: boolean };
const assertSuper = (a: Actor) => {
  if (!a.isSuperAdmin) throw forbidden();
};

export const RESERVED_SLUGS = new Set(["www", "app", "api", "admin", "platform", "login", "card", "static", "assets", "mail", "support"]);

export const institutionInput = z.object({
  name: z.string().trim().min(3).max(160),
  shortName: z.string().trim().min(2).max(40),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "Slug must be 3–40 lowercase letters, digits or hyphens")
    .refine((s) => !RESERVED_SLUGS.has(s), "This slug is reserved"),
  city: z.string().trim().max(80).optional().nullable(),
  contactEmail: z.email().optional().nullable(),
  plan: z.enum(["starter", "standard", "enterprise"]),
  licensedModules: z.array(z.enum(MODULE_KEYS as [string, ...string[]])).min(1, "License at least one module"),
  studentLimit: z.number().int().min(1).max(1_000_000),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.email().transform((e) => e.toLowerCase()),
  /** Optional: super admin chooses the first password. Blank = generate one. Always must-change at first sign-in. */
  adminPassword: z.string().optional().nullable(),
});

/** Onboard a college: tenant row, default portal config, first college admin. */
export async function createInstitution(actor: Actor, input: z.input<typeof institutionInput>) {
  assertSuper(actor);
  const data = institutionInput.parse(input);
  const db = getDb();
  const [clash] = await db.select({ id: institutions.id }).from(institutions).where(eq(institutions.slug, data.slug)).limit(1);
  if (clash) throw badRequest("That slug is already taken.");

  const tempPassword = chosenOrGenerated(data.adminPassword);
  const passwordHash = await hashPassword(tempPassword);
  return db.transaction(async (tx) => {
    const [inst] = await tx
      .insert(institutions)
      .values({
        name: data.name,
        shortName: data.shortName,
        slug: data.slug,
        city: data.city ?? null,
        contactEmail: data.contactEmail ?? null,
        plan: data.plan,
        licensedModules: data.licensedModules,
        studentLimit: data.studentLimit,
      })
      .returning();
    const cfg = defaultPortalConfig(data.licensedModules);
    await tx.insert(institutionSettings).values({ institutionId: inst.id, draftConfig: cfg, publishedConfig: cfg, academic: DEFAULT_ACADEMIC, publishedAt: new Date() });

    let [admin] = await tx.select().from(users).where(eq(users.email, data.adminEmail)).limit(1);
    let issuedPassword: string | null = null;
    if (!admin) {
      [admin] = await tx.insert(users).values({ email: data.adminEmail, name: data.adminName, passwordHash, mustChangePassword: true }).returning();
      issuedPassword = tempPassword;
    }
    await tx.insert(memberships).values({ userId: admin.id, institutionId: inst.id, role: "college_admin" });
    await platformAudit(actor, { institutionId: inst.id, action: "institution.create", entityType: "institution", entityId: inst.id, summary: `Onboarded ${inst.name} (${inst.slug})`, metadata: { plan: data.plan, modules: data.licensedModules } }, tx);
    return { institution: inst, adminEmail: data.adminEmail, tempPassword: issuedPassword };
  });
}

/** Super-admin chosen passwords must be at least 10 chars with letters and digits; blank generates one. */
export function chosenOrGenerated(pw: string | null | undefined) {
  const p = (pw ?? "").trim();
  if (!p) return generateTempPassword();
  if (p.length < 10 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) throw badRequest("Password must be at least 10 characters with letters and numbers.");
  return p;
}

async function assertInstitution(id: string) {
  const [inst] = await getDb().select().from(institutions).where(eq(institutions.id, id)).limit(1);
  if (!inst) throw notFound("College");
  return inst;
}

/** Add another college administrator (or promote an existing account to one). */
export async function addCollegeAdmin(actor: Actor, institutionId: string, input: { name: string; email: string; password?: string | null }) {
  assertSuper(actor);
  const inst = await assertInstitution(institutionId);
  const d = z.object({ name: z.string().trim().min(2).max(120), email: z.email().transform((e) => e.toLowerCase()) }).parse(input);
  const password = chosenOrGenerated(input.password);
  const hash = await hashPassword(password);
  return getDb().transaction(async (tx) => {
    let [u] = await tx.select().from(users).where(eq(users.email, d.email)).limit(1);
    let issued: string | null = null;
    if (!u) {
      [u] = await tx.insert(users).values({ email: d.email, name: d.name, passwordHash: hash, mustChangePassword: true }).returning();
      issued = password;
    }
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.institutionId, inst.id))).limit(1);
    if (m) await tx.update(memberships).set({ role: "college_admin", status: "active", departmentId: null }).where(eq(memberships.id, m.id));
    else await tx.insert(memberships).values({ userId: u.id, institutionId: inst.id, role: "college_admin" });
    await platformAudit(actor, { institutionId: inst.id, action: "membership.grant", entityType: "membership", entityId: u.id, summary: `Platform added college admin ${d.email} to ${inst.name}` }, tx);
    return { email: u.email, password: issued };
  });
}

/**
 * Reset a college administrator's password (forgotten password, or handing over credentials).
 * Only accounts that are college admins of THIS college can be reset here; their sessions are revoked.
 */
export async function resetCollegeAdminPassword(actor: Actor, institutionId: string, userId: string, password?: string | null) {
  assertSuper(actor);
  const inst = await assertInstitution(institutionId);
  const [row] = await getDb()
    .select({ user: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.institutionId, inst.id), eq(memberships.userId, userId), eq(memberships.role, "college_admin")))
    .limit(1);
  if (!row) throw notFound("College administrator");
  if (row.user.isSuperAdmin) throw badRequest("Platform accounts cannot be reset from here.");
  const pw = chosenOrGenerated(password);
  await getDb().update(users).set({ passwordHash: await hashPassword(pw), mustChangePassword: true, status: "active" }).where(eq(users.id, row.user.id));
  await getDb().delete(sessions).where(eq(sessions.userId, row.user.id));
  await platformAudit(actor, { institutionId: inst.id, action: "credentials.reset", entityType: "membership", entityId: row.user.id, summary: `Platform reset password for college admin ${row.user.email}` });
  return { email: row.user.email, password: pw };
}

export async function listInstitutions(actor: Actor) {
  assertSuper(actor);
  const db = getDb();
  const rows = await db
    .select({
      inst: institutions,
      studentCount: sql<number>`(select count(*)::int from ${students} s where s.institution_id = ${ref(institutions.id)} and s.status <> 'archived')`,
      facultyCount: sql<number>`(select count(*)::int from ${faculty} f where f.institution_id = ${ref(institutions.id)})`,
      activeCards: sql<number>`(select count(*)::int from ${nfcCards} c where c.institution_id = ${ref(institutions.id)} and c.status = 'active')`,
      memberCount: sql<number>`(select count(*)::int from ${memberships} m where m.institution_id = ${ref(institutions.id)})`,
    })
    .from(institutions)
    .orderBy(institutions.name);
  return rows;
}

export async function setInstitutionStatus(actor: Actor, institutionId: string, status: "active" | "suspended", reason: string) {
  assertSuper(actor);
  if (!reason.trim()) throw badRequest("A reason is required.");
  const db = getDb();
  const [inst] = await db.update(institutions).set({ status }).where(eq(institutions.id, institutionId)).returning();
  if (!inst) throw notFound("College");
  await platformAudit(actor, { institutionId, action: `institution.${status === "active" ? "activate" : "suspend"}`, entityType: "institution", entityId: institutionId, summary: `${status === "active" ? "Activated" : "Suspended"} ${inst.name}: ${reason}` });
  return inst;
}

export async function updateSubscription(actor: Actor, institutionId: string, input: { plan: string; licensedModules: string[]; studentLimit: number }) {
  assertSuper(actor);
  const data = institutionInput.pick({ plan: true, licensedModules: true, studentLimit: true }).parse(input);
  const db = getDb();
  const [inst] = await db.update(institutions).set(data).where(eq(institutions.id, institutionId)).returning();
  if (!inst) throw notFound("College");
  await platformAudit(actor, { institutionId, action: "institution.subscription", entityType: "institution", entityId: institutionId, summary: `Updated subscription for ${inst.name}`, metadata: data });
  return inst;
}

export async function platformStats(actor: Actor) {
  assertSuper(actor);
  const db = getDb();
  const [[inst], [stu], [usr], [cards], [grants]] = await Promise.all([
    db.select({ total: count(), active: sql<number>`count(*) filter (where ${institutions.status} = 'active')::int` }).from(institutions),
    db.select({ total: count() }).from(students).where(sql`${students.status} <> 'archived'`),
    db.select({ total: count() }).from(users),
    db.select({ total: count() }).from(nfcCards).where(eq(nfcCards.status, "active")),
    db.select({ total: count() }).from(supportGrants).where(and(gt(supportGrants.expiresAt, new Date()), isNull(supportGrants.revokedAt))),
  ]);
  let dbOk = true;
  try {
    await db.execute(sql`select 1`);
  } catch {
    dbOk = false;
  }
  return { institutions: inst.total, activeInstitutions: inst.active, students: stu.total, users: usr.total, activeCards: cards.total, activeSupportGrants: grants.total, dbOk, storage: await storageHealth() };
}

/** Write, read back and delete a small probe object, so misconfigured file storage is visible to operators. */
async function storageHealth(): Promise<{ ok: boolean; backend: string; error?: string }> {
  const s = storage();
  const backend = storageBackend();
  const key = `_healthcheck/${crypto.randomUUID()}`;
  try {
    const probe = Buffer.from(`ok ${Date.now()}`);
    await s.put(key, probe);
    const back = await s.get(key);
    await s.remove(key);
    return { ok: back.equals(probe), backend };
  } catch (e) {
    return { ok: false, backend, error: e instanceof Error ? e.message.slice(0, 120) : "unknown error" };
  }
}

export async function platformAuditLog(actor: Actor, limit = 100) {
  assertSuper(actor);
  return getDb()
    .select({ log: auditLogs, institution: institutions.name })
    .from(auditLogs)
    .leftJoin(institutions, eq(institutions.id, auditLogs.institutionId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

export async function activeSupportGrants(actor: Actor) {
  assertSuper(actor);
  return getDb()
    .select({ grant: supportGrants, institution: institutions })
    .from(supportGrants)
    .innerJoin(institutions, eq(institutions.id, supportGrants.institutionId))
    .where(and(gt(supportGrants.expiresAt, new Date()), isNull(supportGrants.revokedAt)))
    .orderBy(desc(supportGrants.createdAt));
}

/** Workspaces the signed-in user can open. */
export async function myWorkspaces(userId: string) {
  return getDb()
    .select({ role: memberships.role, slug: institutions.slug, name: institutions.name, status: institutions.status, membershipStatus: memberships.status })
    .from(memberships)
    .innerJoin(institutions, eq(institutions.id, memberships.institutionId))
    .where(eq(memberships.userId, userId))
    .orderBy(institutions.name);
}

export async function getInstitution(actor: Actor, id: string) {
  assertSuper(actor);
  const [inst] = await getDb().select().from(institutions).where(eq(institutions.id, id)).limit(1);
  if (!inst) throw notFound("College");
  const admins = await getDb()
    .select({ userId: users.id, name: users.name, email: users.email, status: memberships.status, lastLoginAt: users.lastLoginAt, mustChangePassword: users.mustChangePassword })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.institutionId, id), eq(memberships.role, "college_admin")));
  return { inst, admins };
}
