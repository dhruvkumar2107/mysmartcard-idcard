import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ref } from "@/db/sql";
import { getDb } from "@/db";
import { libraryBooks, libraryLoans, students } from "@/db/schema";
import { badRequest } from "@/lib/errors";
import { addDaysISO, todayISO } from "@/lib/format";
import { audit } from "../audit";
import { assertAdminWrite, assertCan, type TenantContext } from "../context";
import { owned } from "./guard";

export const LIBRARY_RULES = { loanDays: 14, maxRenewals: 2, maxActiveLoans: 4, finePerDay: 200 /* minor units */ };

export function fineFor(dueAt: string, returnedAt: string) {
  const days = Math.floor((Date.parse(returnedAt) - Date.parse(dueAt)) / 86_400_000);
  return Math.max(0, days) * LIBRARY_RULES.finePerDay;
}

export async function addBook(ctx: TenantContext, input: { accessionNo: string; isbn: string | null; title: string; author: string | null }) {
  assertAdminWrite(ctx, "library.manage");
  const d = z.object({ accessionNo: z.string().trim().toUpperCase().min(1).max(30), isbn: z.string().max(20).nullable(), title: z.string().trim().min(1).max(300), author: z.string().max(200).nullable() }).parse(input);
  const [row] = await getDb().insert(libraryBooks).values({ ...d, institutionId: ctx.institution.id }).returning();
  await audit(ctx, { action: "library.book_add", entityType: "library_book", entityId: row.id, summary: `Catalogued ${row.accessionNo} "${row.title}"` });
  return row;
}

export async function listBooks(ctx: TenantContext, q?: string) {
  assertCan(ctx, "library.manage");
  const conds = [eq(libraryBooks.institutionId, ctx.institution.id)];
  if (q?.trim()) conds.push(or(ilike(libraryBooks.title, `%${q.trim()}%`), ilike(libraryBooks.accessionNo, `%${q.trim()}%`), ilike(libraryBooks.author, `%${q.trim()}%`))!);
  return getDb()
    .select({
      book: libraryBooks,
      onLoanTo: sql<string | null>`(select s.enrollment_no from ${libraryLoans} l join ${students} s on s.id = l.student_id where l.book_id = ${ref(libraryBooks.id)} and l.returned_at is null limit 1)`,
    })
    .from(libraryBooks)
    .where(and(...conds))
    .orderBy(asc(libraryBooks.title))
    .limit(200);
}

export async function issueBook(ctx: TenantContext, input: { accessionNo: string; enrollmentNo: string }) {
  assertAdminWrite(ctx, "library.manage");
  const db = getDb();
  const [book] = await db.select().from(libraryBooks).where(and(eq(libraryBooks.institutionId, ctx.institution.id), eq(libraryBooks.accessionNo, input.accessionNo.trim().toUpperCase()))).limit(1);
  if (!book) throw badRequest("No book with that accession number.");
  const [s] = await db.select().from(students).where(and(eq(students.institutionId, ctx.institution.id), eq(students.enrollmentNo, input.enrollmentNo.trim().toUpperCase()))).limit(1);
  if (!s || s.status !== "active") throw badRequest("No active student with that enrollment number.");
  const [onLoan] = await db.select({ id: libraryLoans.id }).from(libraryLoans).where(and(eq(libraryLoans.bookId, book.id), isNull(libraryLoans.returnedAt))).limit(1);
  if (onLoan) throw badRequest("This copy is already on loan.");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(libraryLoans).where(and(eq(libraryLoans.studentId, s.id), isNull(libraryLoans.returnedAt)));
  if (n >= LIBRARY_RULES.maxActiveLoans) throw badRequest(`Student already has ${n} books (limit ${LIBRARY_RULES.maxActiveLoans}).`);
  const issuedAt = todayISO();
  const [loan] = await db.insert(libraryLoans).values({ institutionId: ctx.institution.id, bookId: book.id, studentId: s.id, issuedAt, dueAt: addDaysISO(issuedAt, LIBRARY_RULES.loanDays) }).returning();
  await audit(ctx, { action: "library.issue", entityType: "library_loan", entityId: loan.id, summary: `Issued ${book.accessionNo} to ${s.enrollmentNo}` });
  return loan;
}

export async function returnBook(ctx: TenantContext, loanId: string) {
  assertAdminWrite(ctx, "library.manage");
  const loan = await owned(ctx, libraryLoans, loanId, "Loan");
  if (loan.returnedAt) throw badRequest("Already returned.");
  const returnedAt = todayISO();
  const fine = fineFor(loan.dueAt, returnedAt);
  await getDb().update(libraryLoans).set({ returnedAt, fineAmount: fine }).where(eq(libraryLoans.id, loan.id));
  await audit(ctx, { action: "library.return", entityType: "library_loan", entityId: loan.id, summary: `Book returned${fine ? `, fine ${(fine / 100).toFixed(2)}` : ""}` });
}

export function renewalEligibility(loan: { returnedAt: string | null; renewals: number; dueAt: string }) {
  if (loan.returnedAt) return { ok: false, reason: "Returned" };
  if (loan.renewals >= LIBRARY_RULES.maxRenewals) return { ok: false, reason: "Renewal limit reached" };
  if (loan.dueAt < todayISO()) return { ok: false, reason: "Overdue — return at the desk" };
  return { ok: true, reason: `${LIBRARY_RULES.maxRenewals - loan.renewals} renewal(s) left` };
}

export async function renewLoan(ctx: TenantContext, loanId: string) {
  assertAdminWrite(ctx, "library.manage");
  const loan = await owned(ctx, libraryLoans, loanId, "Loan");
  const el = renewalEligibility(loan);
  if (!el.ok) throw badRequest(el.reason);
  await getDb()
    .update(libraryLoans)
    .set({ renewals: loan.renewals + 1, dueAt: addDaysISO(loan.dueAt, LIBRARY_RULES.loanDays) })
    .where(eq(libraryLoans.id, loan.id));
  await audit(ctx, { action: "library.renew", entityType: "library_loan", entityId: loan.id, summary: "Renewed loan" });
}

export async function markFinePaid(ctx: TenantContext, loanId: string) {
  assertAdminWrite(ctx, "library.manage");
  const loan = await owned(ctx, libraryLoans, loanId, "Loan");
  await getDb().update(libraryLoans).set({ finePaid: true }).where(eq(libraryLoans.id, loan.id));
  await audit(ctx, { action: "library.fine_paid", entityType: "library_loan", entityId: loan.id, summary: `Fine of ${(loan.fineAmount / 100).toFixed(2)} paid` });
}

export async function activeLoans(ctx: TenantContext) {
  assertCan(ctx, "library.manage");
  return getDb()
    .select({ loan: libraryLoans, title: libraryBooks.title, accessionNo: libraryBooks.accessionNo, studentName: students.fullName, enrollmentNo: students.enrollmentNo })
    .from(libraryLoans)
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryLoans.bookId))
    .innerJoin(students, eq(students.id, libraryLoans.studentId))
    .where(and(eq(libraryLoans.institutionId, ctx.institution.id), or(isNull(libraryLoans.returnedAt), and(sql`${libraryLoans.fineAmount} > 0`, eq(libraryLoans.finePaid, false)))))
    .orderBy(asc(libraryLoans.dueAt));
}

export async function loansForStudent(ctx: TenantContext, studentId: string) {
  return getDb()
    .select({ loan: libraryLoans, title: libraryBooks.title, author: libraryBooks.author, accessionNo: libraryBooks.accessionNo, isbn: libraryBooks.isbn })
    .from(libraryLoans)
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryLoans.bookId))
    .where(and(eq(libraryLoans.institutionId, ctx.institution.id), eq(libraryLoans.studentId, studentId)))
    .orderBy(desc(libraryLoans.issuedAt));
}
