import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { departments, faculty, memberships, users } from "@/db/schema";
import { generateTempPassword } from "@/lib/crypto";
import { badRequest } from "@/lib/errors";
import { ROLES, type Role } from "@/lib/permissions";
import { hashPassword } from "../auth";
import { audit } from "../audit";
import { assertAdminWrite, assertCan, type TenantContext } from "../context";
import { owned, ownedOrNull } from "./guard";

const STAFF_ROLES = ROLES.filter((r) => r !== "student") as Exclude<Role, "student">[];

export async function listFaculty(ctx: TenantContext) {
  assertCan(ctx, "faculty.view");
  const conds = [eq(faculty.institutionId, ctx.institution.id)];
  if (ctx.scope.kind === "department" && ctx.departmentId) conds.push(eq(faculty.departmentId, ctx.departmentId));
  return getDb()
    .select({ faculty, departmentCode: departments.code, role: memberships.role, membershipStatus: memberships.status })
    .from(faculty)
    .leftJoin(departments, eq(departments.id, faculty.departmentId))
    .leftJoin(memberships, and(eq(memberships.userId, faculty.userId), eq(memberships.institutionId, faculty.institutionId)))
    .where(and(...conds))
    .orderBy(asc(faculty.name));
}

const facultyInput = z.object({
  employeeCode: z.string().trim().toUpperCase().min(1).max(30),
  name: z.string().trim().min(2).max(120),
  email: z.email().nullable(),
  phone: z.string().trim().max(20).nullable(),
  designation: z.string().trim().max(80).nullable(),
  departmentId: z.string().nullable(),
});

export async function createFaculty(ctx: TenantContext, input: z.input<typeof facultyInput>) {
  assertAdminWrite(ctx, "faculty.edit");
  const d = facultyInput.parse(input);
  await ownedOrNull(ctx, departments, d.departmentId, "Department");
  const [row] = await getDb().insert(faculty).values({ ...d, email: d.email?.toLowerCase() ?? null, institutionId: ctx.institution.id }).returning();
  await audit(ctx, { action: "faculty.create", entityType: "faculty", entityId: row.id, summary: `Added faculty ${row.employeeCode} – ${row.name}` });
  return row;
}

export async function updateFaculty(ctx: TenantContext, id: string, input: z.input<typeof facultyInput> & { status: string }) {
  assertAdminWrite(ctx, "faculty.edit");
  const before = await owned(ctx, faculty, id, "Faculty member");
  const d = facultyInput.extend({ status: z.enum(["active", "inactive"]) }).parse(input);
  await ownedOrNull(ctx, departments, d.departmentId, "Department");
  const [row] = await getDb().update(faculty).set(d).where(and(eq(faculty.id, before.id), eq(faculty.institutionId, ctx.institution.id))).returning();
  await audit(ctx, { action: "faculty.update", entityType: "faculty", entityId: row.id, summary: `Updated faculty ${row.employeeCode}` });
  return row;
}

/** Give a faculty record a login with a staff role. */
export async function grantStaffAccess(ctx: TenantContext, facultyId: string, role: string) {
  assertAdminWrite(ctx, "users.manage");
  const f = await owned(ctx, faculty, facultyId, "Faculty member");
  if (!STAFF_ROLES.includes(role as never)) throw badRequest("Choose a staff role.");
  if (!f.email) throw badRequest("Add an email address to this faculty record first.");
  const db = getDb();
  const temp = generateTempPassword();
  const hash = await hashPassword(temp);
  return db.transaction(async (tx) => {
    let [u] = await tx.select().from(users).where(eq(users.email, f.email!)).limit(1);
    let issued: string | null = null;
    if (!u) {
      [u] = await tx.insert(users).values({ email: f.email!, name: f.name, passwordHash: hash, mustChangePassword: true }).returning();
      issued = temp;
    }
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.institutionId, ctx.institution.id))).limit(1);
    if (m?.role === "student") throw badRequest("This email is registered as a student in your college.");
    const departmentId = role === "hod" ? f.departmentId : null;
    if (role === "hod" && !departmentId) throw badRequest("Assign the faculty member to a department before making them HOD.");
    if (m) await tx.update(memberships).set({ role, status: "active", departmentId }).where(eq(memberships.id, m.id));
    else await tx.insert(memberships).values({ userId: u.id, institutionId: ctx.institution.id, role, departmentId });
    await tx.update(faculty).set({ userId: u.id }).where(eq(faculty.id, f.id));
    await audit(ctx, { action: "membership.grant", entityType: "membership", entityId: u.id, summary: `Granted ${role} access to ${f.name}`, metadata: { role } }, tx);
    return { email: u.email, tempPassword: issued };
  });
}

export async function listStaff(ctx: TenantContext) {
  assertCan(ctx, "users.manage");
  return getDb()
    .select({ membership: memberships, user: { id: users.id, name: users.name, email: users.email, lastLoginAt: users.lastLoginAt }, departmentCode: departments.code })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(departments, eq(departments.id, memberships.departmentId))
    .where(and(eq(memberships.institutionId, ctx.institution.id)))
    .orderBy(asc(memberships.role), asc(users.name));
}

/** Create a staff login not tied to a faculty record (e.g. accountant, librarian). */
export async function createStaffUser(ctx: TenantContext, input: { name: string; email: string; role: string; departmentId: string | null }) {
  assertAdminWrite(ctx, "users.manage");
  const d = z.object({ name: z.string().trim().min(2).max(120), email: z.email().transform((e) => e.toLowerCase()), role: z.enum(STAFF_ROLES as [string, ...string[]]), departmentId: z.string().nullable() }).parse(input);
  if (d.role === "hod" && !d.departmentId) throw badRequest("Select the department this HOD leads.");
  await ownedOrNull(ctx, departments, d.departmentId, "Department");
  const db = getDb();
  const temp = generateTempPassword();
  const hash = await hashPassword(temp);
  return db.transaction(async (tx) => {
    let [u] = await tx.select().from(users).where(eq(users.email, d.email)).limit(1);
    let issued: string | null = null;
    if (!u) {
      [u] = await tx.insert(users).values({ email: d.email, name: d.name, passwordHash: hash, mustChangePassword: true }).returning();
      issued = temp;
    }
    const [m] = await tx.select().from(memberships).where(and(eq(memberships.userId, u.id), eq(memberships.institutionId, ctx.institution.id))).limit(1);
    if (m) throw badRequest("This person already has access to your college. Change their role instead.");
    await tx.insert(memberships).values({ userId: u.id, institutionId: ctx.institution.id, role: d.role, departmentId: d.role === "hod" ? d.departmentId : null });
    await audit(ctx, { action: "membership.grant", entityType: "membership", entityId: u.id, summary: `Created ${d.role} account for ${d.name}` }, tx);
    return { email: u.email, tempPassword: issued };
  });
}

export async function updateMembership(ctx: TenantContext, membershipId: string, input: { role: string; status: string; departmentId: string | null }) {
  assertAdminWrite(ctx, "users.manage");
  const m = await owned(ctx, memberships, membershipId, "Account");
  if (m.role === "student") throw badRequest("Manage student accounts from the student profile.");
  const d = z.object({ role: z.enum(STAFF_ROLES as [string, ...string[]]), status: z.enum(["active", "disabled"]), departmentId: z.string().nullable() }).parse(input);
  await ownedOrNull(ctx, departments, d.departmentId, "Department");
  if (m.userId === ctx.user.id && (d.role !== "college_admin" || d.status !== "active")) throw badRequest("You cannot demote or disable your own administrator account.");
  if (m.role === "college_admin" && (d.role !== "college_admin" || d.status !== "active")) {
    const admins = await getDb().select({ id: memberships.id }).from(memberships).where(and(eq(memberships.institutionId, ctx.institution.id), eq(memberships.role, "college_admin"), eq(memberships.status, "active")));
    if (admins.length <= 1) throw badRequest("A college must keep at least one active administrator.");
  }
  await getDb().update(memberships).set({ role: d.role, status: d.status, departmentId: d.role === "hod" ? d.departmentId : null }).where(eq(memberships.id, m.id));
  await audit(ctx, { action: "membership.update", entityType: "membership", entityId: m.id, summary: `Changed role ${m.role} → ${d.role}, status ${d.status}`, metadata: { from: { role: m.role, status: m.status }, to: d } });
}
