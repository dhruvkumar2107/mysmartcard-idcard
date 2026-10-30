import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ref } from "@/db/sql";
import { getDb } from "@/db";
import { moduleVisibleToStudent } from "@/lib/portal-config";
import { feeDemands, feePayments, students, users } from "@/db/schema";
import { badRequest } from "@/lib/errors";
import { audit } from "../audit";
import { assertAdminWrite, assertCan, type TenantContext } from "../context";
import { owned, ownedOrNull } from "./guard";

export const FEE_CATEGORIES = ["tuition", "exam", "hostel", "transport", "library", "lab", "other"] as const;
export const PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "cheque", "card_pos"] as const;

const demandInput = z.object({
  studentId: z.string(),
  category: z.enum(FEE_CATEGORIES),
  description: z.string().max(200).nullable(),
  amount: z.number().int().positive().max(100_000_000_00),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  academicYear: z.string().regex(/^\d{4}-\d{2}$/),
});

export async function addFeeDemand(ctx: TenantContext, input: z.input<typeof demandInput>) {
  assertAdminWrite(ctx, "fees.manage");
  const d = demandInput.parse(input);
  const s = await owned(ctx, students, d.studentId, "Student");
  const [row] = await getDb().insert(feeDemands).values({ ...d, institutionId: ctx.institution.id }).returning();
  await audit(ctx, { action: "fee.demand", entityType: "student", entityId: s.id, summary: `Raised ${d.category} fee of ${(d.amount / 100).toFixed(2)} for ${s.enrollmentNo}` });
  return row;
}

/** Apply the same demand to every active student of a section/programme/semester. */
export async function bulkFeeDemand(ctx: TenantContext, input: Omit<z.input<typeof demandInput>, "studentId"> & { programmeId: string | null; semester: number | null }) {
  assertAdminWrite(ctx, "fees.manage");
  const d = demandInput.omit({ studentId: true }).parse(input);
  const conds = [eq(students.institutionId, ctx.institution.id), eq(students.status, "active")];
  if (input.programmeId) conds.push(eq(students.programmeId, input.programmeId));
  if (input.semester) conds.push(eq(students.semester, input.semester));
  const targets = await getDb().select({ id: students.id }).from(students).where(and(...conds));
  if (!targets.length) throw badRequest("No active students match.");
  await getDb().insert(feeDemands).values(targets.map((t) => ({ ...d, studentId: t.id, institutionId: ctx.institution.id })));
  await audit(ctx, { action: "fee.bulk_demand", entityType: "fee_demand", summary: `Raised ${d.category} fee for ${targets.length} student(s)` });
  return targets.length;
}

async function nextReceiptNo(ctx: TenantContext, tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0]) {
  // Serialize receipt numbering per institution within the transaction.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"receipt:" + ctx.institution.id}))`);
  const year = new Date().getFullYear();
  const prefix = `${ctx.institution.shortName.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}-${year}-`;
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(feePayments)
    .where(and(eq(feePayments.institutionId, ctx.institution.id), sql`${feePayments.receiptNo} like ${prefix + "%"}`));
  return `${prefix}${String(n + 1).padStart(6, "0")}`;
}

const paymentInput = z.object({
  studentId: z.string(),
  demandId: z.string().nullable(),
  amount: z.number().int().positive(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().max(80).nullable(),
  paidAt: z.date(),
});

/** Record an offline/externally-settled payment. No card data is ever accepted or stored. */
export async function recordPayment(ctx: TenantContext, input: z.input<typeof paymentInput>) {
  assertAdminWrite(ctx, "fees.manage");
  const d = paymentInput.parse(input);
  const s = await owned(ctx, students, d.studentId, "Student");
  const demand = await ownedOrNull(ctx, feeDemands, d.demandId, "Fee demand");
  if (demand && demand.studentId !== s.id) throw badRequest("That fee demand belongs to another student.");
  if (d.reference && /\b\d{13,19}\b/.test(d.reference.replace(/[\s-]/g, ""))) throw badRequest("Do not enter card numbers. Use the transaction / UTR reference only.");
  if (d.paidAt > new Date()) throw badRequest("Payment date cannot be in the future.");
  const db = getDb();
  return db.transaction(async (tx) => {
    const receiptNo = await nextReceiptNo(ctx, tx);
    const [p] = await tx.insert(feePayments).values({ ...d, institutionId: ctx.institution.id, receiptNo, recordedByUserId: ctx.user.id }).returning();
    await audit(ctx, { action: "fee.payment", entityType: "student", entityId: s.id, summary: `Recorded payment ${receiptNo} of ${(d.amount / 100).toFixed(2)} (${d.method}) for ${s.enrollmentNo}` }, tx);
    return p;
  });
}

export async function reconcilePayment(ctx: TenantContext, paymentId: string) {
  assertAdminWrite(ctx, "fees.manage");
  const p = await owned(ctx, feePayments, paymentId, "Payment");
  if (p.reconciled) throw badRequest("Already reconciled.");
  if (p.recordedByUserId === ctx.user.id && ctx.role !== "college_admin") throw badRequest("A different officer must reconcile this payment.");
  await getDb().update(feePayments).set({ reconciled: true, reconciledByUserId: ctx.user.id }).where(eq(feePayments.id, p.id));
  await audit(ctx, { action: "fee.reconcile", entityType: "fee_payment", entityId: p.id, summary: `Reconciled receipt ${p.receiptNo}` });
}

export async function studentLedger(ctx: TenantContext, studentId: string) {
  const db = getDb();
  const [demands, payments] = await Promise.all([
    db.select().from(feeDemands).where(and(eq(feeDemands.institutionId, ctx.institution.id), eq(feeDemands.studentId, studentId))).orderBy(asc(feeDemands.dueDate)),
    db.select().from(feePayments).where(and(eq(feePayments.institutionId, ctx.institution.id), eq(feePayments.studentId, studentId))).orderBy(desc(feePayments.paidAt)),
  ]);
  const payable = demands.reduce((s, d) => s + d.amount, 0);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const paidByDemand = new Map<string, number>();
  for (const p of payments) if (p.demandId) paidByDemand.set(p.demandId, (paidByDemand.get(p.demandId) ?? 0) + p.amount);
  const today = new Date().toISOString().slice(0, 10);
  const items = demands.map((d) => {
    const paidAmt = paidByDemand.get(d.id) ?? 0;
    const status = paidAmt >= d.amount ? "paid" : paidAmt > 0 ? "partial" : d.dueDate && d.dueDate < today ? "overdue" : "due";
    return { ...d, paid: paidAmt, status };
  });
  return { demands: items, payments, payable, paid, balance: payable - paid };
}

export async function receipt(ctx: TenantContext, paymentId: string) {
  const p = await owned(ctx, feePayments, paymentId, "Receipt");
  const s = await owned(ctx, students, p.studentId, "Student");
  if (ctx.role === "student" && ctx.studentId !== s.id) throw badRequest("Receipt not found.");
  // Fee records are admin-only unless the super admin enabled the fee section for this college.
  if (ctx.role === "student" && !moduleVisibleToStudent(ctx.portalConfig, "fees", s)) throw badRequest("Receipt not found.");
  if (ctx.role !== "student") assertCan(ctx, "fees.view");
  const demand = p.demandId ? await ownedOrNull(ctx, feeDemands, p.demandId) : null;
  const [recordedBy] = p.recordedByUserId ? await getDb().select({ name: users.name }).from(users).where(eq(users.id, p.recordedByUserId)) : [];
  return { payment: p, student: s, demand, recordedBy: recordedBy?.name ?? null };
}

export async function feeOverview(ctx: TenantContext) {
  assertCan(ctx, "fees.view");
  const db = getDb();
  const [[dem], [pay], recent, defaulters] = await Promise.all([
    db.select({ total: sql<number>`coalesce(sum(${feeDemands.amount}),0)::bigint` }).from(feeDemands).where(eq(feeDemands.institutionId, ctx.institution.id)),
    db
      .select({ total: sql<number>`coalesce(sum(${feePayments.amount}),0)::bigint`, unreconciled: sql<number>`count(*) filter (where not ${feePayments.reconciled})::int` })
      .from(feePayments)
      .where(eq(feePayments.institutionId, ctx.institution.id)),
    db
      .select({ payment: feePayments, studentName: students.fullName, enrollmentNo: students.enrollmentNo })
      .from(feePayments)
      .innerJoin(students, eq(students.id, feePayments.studentId))
      .where(eq(feePayments.institutionId, ctx.institution.id))
      .orderBy(desc(feePayments.createdAt))
      .limit(30),
    db
      .select({
        id: students.id,
        name: students.fullName,
        enrollmentNo: students.enrollmentNo,
        balance: sql<string>`(coalesce((select sum(d.amount) from ${feeDemands} d where d.student_id = ${ref(students.id)}),0) - coalesce((select sum(p.amount) from ${feePayments} p where p.student_id = ${ref(students.id)}),0))`.as("balance"),
      })
      .from(students)
      .where(and(eq(students.institutionId, ctx.institution.id), eq(students.status, "active")))
      .orderBy(sql`balance desc`)
      .limit(15),
  ]);
  return {
    demanded: Number(dem.total),
    collected: Number(pay.total),
    unreconciled: pay.unreconciled,
    recent,
    defaulters: defaulters.map((r) => ({ ...r, balance: Number(r.balance) })).filter((r) => r.balance > 0),
  };
}
