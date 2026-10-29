import Link from "next/link";
import { Card, EmptyState, Field, Flash, Input, PageHeader, Select, Stat, StatusBadge, Table, Td, TenantFields, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { FeesView } from "@/components/views";
import { formatDate, formatMoney, titleCase, todayISO } from "@/lib/format";
import { flashOf, one, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { FEE_CATEGORIES, PAYMENT_METHODS, feeOverview, studentLedger } from "@/server/services/finance";
import { listStudents } from "@/server/services/students";
import { listStructure } from "@/server/services/academics";
import { addFeeDemandAction, reconcilePaymentAction, recordPaymentAction } from "@/server/actions/admin";

export const metadata = { title: "Fees" };

export default async function FeesPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "fees.view");
  const manage = ctx.perms.has("fees.manage") && !ctx.viaSupport;
  const base = `/c/${slug}/admin/fees`;
  const studentQ = one(sp.student);
  const [ov, found, s] = await Promise.all([feeOverview(ctx), studentQ ? listStudents(ctx, { q: studentQ, pageSize: 10, status: "all" }) : null, listStructure(ctx)]);
  const selected = found?.rows.length === 1 ? found.rows[0].student : found?.rows.find((r) => r.student.enrollmentNo === studentQ?.toUpperCase())?.student;
  const ledger = selected ? await studentLedger(ctx, selected.id) : null;
  const here = studentQ ? `${base}?student=${encodeURIComponent(studentQ)}` : base;

  return (
    <>
      <PageHeader title="Fees & receipts" description="Record payments received at the office or by bank transfer, issue receipts and reconcile." />
      <Flash searchParams={flashOf(sp)} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total demanded" value={formatMoney(ov.demanded)} />
        <Stat label="Collected" value={formatMoney(ov.collected)} tone="ok" />
        <Stat label="Outstanding" value={formatMoney(Math.max(0, ov.demanded - ov.collected))} tone="warn" />
        <Stat label="Awaiting reconciliation" value={ov.unreconciled} />
      </div>

      <Card title="Student ledger" className="mt-6">
        <form className="flex gap-2">
          <Input name="student" defaultValue={studentQ} placeholder="Enrollment number or name" className="max-w-sm" aria-label="Student" />
          <button className="rounded-lg border border-line px-3 text-sm hover:bg-surface-2">Open</button>
        </form>
        {found && !selected && (
          <div className="mt-3 text-sm">
            {found.rows.length === 0 ? (
              <p className="text-muted">No student found.</p>
            ) : (
              <ul className="space-y-1">
                {found.rows.map((r) => (
                  <li key={r.student.id}>
                    <Link href={`${base}?student=${r.student.enrollmentNo}`} className="text-brand hover:underline">
                      {r.student.enrollmentNo} · {r.student.fullName}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {selected && ledger && (
          <div className="mt-5 space-y-5">
            <h3 className="font-semibold">
              {selected.fullName} <span className="font-mono text-sm text-muted">{selected.enrollmentNo}</span>
            </h3>
            <FeesView ledger={ledger} receiptHref={(id) => `/c/${slug}/receipt/${id}`} />
            {manage && (
              <div className="grid gap-5 lg:grid-cols-2">
                <Card title="Record payment">
                  <form action={recordPaymentAction} className="grid gap-3 sm:grid-cols-2">
                    <TenantFields slug={slug} back={here} />
                    <input type="hidden" name="studentId" value={selected.id} />
                    <Field label="Towards" className="sm:col-span-2">
                      <Select name="demandId" placeholder="General payment" options={ledger.demands.filter((d) => d.status !== "paid").map((d) => ({ value: d.id, label: `${titleCase(d.category)} · ${formatMoney(d.amount - d.paid)} due` }))} />
                    </Field>
                    <Field label="Amount (₹)">
                      <Input name="amount" inputMode="decimal" required placeholder="25000" />
                    </Field>
                    <Field label="Method">
                      <Select name="method" options={PAYMENT_METHODS.map((m) => ({ value: m, label: titleCase(m) }))} />
                    </Field>
                    <Field label="Reference / UTR" hint="Never enter card numbers">
                      <Input name="reference" maxLength={80} />
                    </Field>
                    <Field label="Paid on">
                      <Input type="date" name="paidAt" defaultValue={todayISO()} max={todayISO()} />
                    </Field>
                    <div className="sm:col-span-2">
                      <SubmitButton>Record & issue receipt</SubmitButton>
                    </div>
                  </form>
                </Card>
                <Card title="Add fee item">
                  <form action={addFeeDemandAction} className="grid gap-3 sm:grid-cols-2">
                    <TenantFields slug={slug} back={here} />
                    <input type="hidden" name="studentId" value={selected.id} />
                    <Field label="Category">
                      <Select name="category" options={FEE_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))} />
                    </Field>
                    <Field label="Amount (₹)">
                      <Input name="amount" inputMode="decimal" required />
                    </Field>
                    <Field label="Description" className="sm:col-span-2">
                      <Input name="description" />
                    </Field>
                    <Field label="Due date">
                      <Input type="date" name="dueDate" />
                    </Field>
                    <Field label="Academic year">
                      <Input name="academicYear" defaultValue={selected.academicYear} pattern="\d{4}-\d{2}" required />
                    </Field>
                    <div className="sm:col-span-2">
                      <SubmitButton variant="secondary">Add</SubmitButton>
                    </div>
                  </form>
                </Card>
              </div>
            )}
          </div>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Recent payments" padded={false}>
          {ov.recent.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No payments recorded" />
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Receipt</Th>
                  <Th>Student</Th>
                  <Th>Amount</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {ov.recent.map((r) => (
                  <tr key={r.payment.id}>
                    <Td>
                      <Link href={`/c/${slug}/receipt/${r.payment.id}`} className="font-mono text-xs text-brand hover:underline">
                        {r.payment.receiptNo}
                      </Link>
                      <div className="text-xs text-muted">{formatDate(r.payment.paidAt)}</div>
                    </Td>
                    <Td className="text-sm">{r.enrollmentNo}</Td>
                    <Td className="tabular-nums">{formatMoney(r.payment.amount)}</Td>
                    <Td>
                      {r.payment.reconciled ? (
                        <StatusBadge status="approved" />
                      ) : manage ? (
                        <form action={reconcilePaymentAction}>
                          <TenantFields slug={slug} back={here} />
                          <input type="hidden" name="id" value={r.payment.id} />
                          <SubmitButton variant="secondary" className="px-2 py-1 text-xs">
                            Reconcile
                          </SubmitButton>
                        </form>
                      ) : (
                        <StatusBadge status="pending" />
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Highest outstanding balances" padded={false}>
            {ov.defaulters.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No outstanding balances" />
              </div>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {ov.defaulters.map((d) => (
                  <li key={d.id} className="flex justify-between px-5 py-2.5">
                    <Link href={`${base}?student=${d.enrollmentNo}`} className="hover:underline">
                      {d.enrollmentNo} · {d.name}
                    </Link>
                    <span className="tabular-nums text-danger">{formatMoney(d.balance)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {manage && (
            <Card title="Raise a fee for a whole cohort">
              <form action={addFeeDemandAction} className="grid gap-3 sm:grid-cols-2">
                <TenantFields slug={slug} back={here} />
                <Field label="Programme">
                  <Select name="programmeId" placeholder="All programmes" options={s.programmes.map((p) => ({ value: p.id, label: p.code }))} />
                </Field>
                <Field label="Semester">
                  <Input type="number" name="semester" min={1} max={12} placeholder="All" />
                </Field>
                <Field label="Category">
                  <Select name="category" options={FEE_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))} />
                </Field>
                <Field label="Amount (₹)">
                  <Input name="amount" inputMode="decimal" required />
                </Field>
                <Field label="Description">
                  <Input name="description" />
                </Field>
                <Field label="Due date">
                  <Input type="date" name="dueDate" />
                </Field>
                <Field label="Academic year">
                  <Input name="academicYear" defaultValue="2026-27" pattern="\d{4}-\d{2}" required />
                </Field>
                <div className="flex items-end">
                  <SubmitButton variant="secondary" confirm="Raise this fee for every active student in the selected cohort?">
                    Raise fee
                  </SubmitButton>
                </div>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
