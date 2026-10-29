import { Badge, Card, EmptyState, Field, Flash, Input, PageHeader, Table, Td, TenantFields, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { formatDate, formatMoney, todayISO } from "@/lib/format";
import { flashOf, one, qs, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { LIBRARY_RULES, activeLoans, listBooks, renewalEligibility } from "@/server/services/library";
import { addBookAction, issueBookAction, loanAction } from "@/server/actions/admin";

export const metadata = { title: "Library" };

export default async function LibraryPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "library.manage");
  const q = one(sp.q);
  const [loans, books] = await Promise.all([activeLoans(ctx), listBooks(ctx, q)]);
  const back = qs(`/c/${slug}/admin/library`, { q });
  const today = todayISO();
  const op = (id: string, value: string, label: string) => (
    <form action={loanAction}>
      <TenantFields slug={slug} back={back} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={value} />
      <SubmitButton variant="secondary" className="px-2 py-1 text-xs">
        {label}
      </SubmitButton>
    </form>
  );

  return (
    <>
      <PageHeader title="Library" description={`Loan period ${LIBRARY_RULES.loanDays} days · up to ${LIBRARY_RULES.maxRenewals} renewals · ${LIBRARY_RULES.maxActiveLoans} books per student · fine ${formatMoney(LIBRARY_RULES.finePerDay)}/day. Librarian-managed records (no external library system connected).`} />
      <Flash searchParams={flashOf(sp)} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Issue a book">
          <form action={issueBookAction} className="grid gap-3 sm:grid-cols-3">
            <TenantFields slug={slug} back={back} />
            <Field label="Accession no.">
              <Input name="accessionNo" required className="uppercase" />
            </Field>
            <Field label="Enrollment no.">
              <Input name="enrollmentNo" required className="uppercase" />
            </Field>
            <div className="flex items-end">
              <SubmitButton>Issue</SubmitButton>
            </div>
          </form>
        </Card>
        <Card title="Catalogue a book">
          <form action={addBookAction} className="grid gap-3 sm:grid-cols-2">
            <TenantFields slug={slug} back={back} />
            <Field label="Accession no.">
              <Input name="accessionNo" required className="uppercase" />
            </Field>
            <Field label="ISBN">
              <Input name="isbn" />
            </Field>
            <Field label="Title">
              <Input name="title" required />
            </Field>
            <Field label="Author">
              <Input name="author" />
            </Field>
            <div>
              <SubmitButton variant="secondary">Add</SubmitButton>
            </div>
          </form>
        </Card>
      </div>

      <Card title="Loans & unpaid fines" className="mt-6" padded={false}>
        {loans.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No books on loan" />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Book</Th>
                <Th>Student</Th>
                <Th>Issued</Th>
                <Th>Due</Th>
                <Th>Fine</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.loan.id}>
                  <Td>
                    <div className="font-medium">{l.title}</div>
                    <div className="font-mono text-xs text-muted">{l.accessionNo}</div>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs">{l.enrollmentNo}</span> {l.studentName}
                  </Td>
                  <Td className="tabular-nums">{formatDate(l.loan.issuedAt)}</Td>
                  <Td className="tabular-nums">
                    {formatDate(l.loan.dueAt)} {!l.loan.returnedAt && l.loan.dueAt < today && <Badge tone="red">Overdue</Badge>}
                  </Td>
                  <Td className="tabular-nums">{l.loan.fineAmount ? formatMoney(l.loan.fineAmount) : "—"}</Td>
                  <Td>
                    <div className="flex gap-1.5">
                      {!l.loan.returnedAt && op(l.loan.id, "return", "Return")}
                      {!l.loan.returnedAt && renewalEligibility(l.loan).ok && op(l.loan.id, "renew", "Renew")}
                      {l.loan.fineAmount > 0 && !l.loan.finePaid && op(l.loan.id, "finePaid", "Fine paid")}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Catalogue" className="mt-6" padded={false}>
        <form className="border-b border-line p-4" role="search">
          <Input name="q" defaultValue={q} placeholder="Search title, author or accession no." className="max-w-sm" aria-label="Search catalogue" />
        </form>
        {books.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No books found" />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Accession</Th>
                <Th>Title</Th>
                <Th>Author</Th>
                <Th>Availability</Th>
              </tr>
            </thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.book.id}>
                  <Td className="font-mono text-xs">{b.book.accessionNo}</Td>
                  <Td>{b.book.title}</Td>
                  <Td>{b.book.author ?? "—"}</Td>
                  <Td>{b.onLoanTo ? <Badge tone="amber">On loan · {b.onLoanTo}</Badge> : <Badge tone="green">Available</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
