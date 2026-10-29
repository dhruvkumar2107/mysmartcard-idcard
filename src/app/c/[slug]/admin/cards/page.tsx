import Link from "next/link";
import { Card, EmptyState, Field, Flash, Input, PageHeader, Select, Stat, StatusBadge, Table, Td, TenantFields, Textarea, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { formatDate } from "@/lib/format";
import { flashOf, one, qs, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { cardCounts, listCards, unassignedCards } from "@/server/services/cards";
import { listStudents } from "@/server/services/students";
import { assignCardAction, registerCardsAction } from "@/server/actions/admin";

export const metadata = { title: "Digital ID & NFC cards" };

export default async function CardsPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "cards.manage");
  const status = one(sp.status) ?? "all";
  const q = one(sp.q);
  const assignFor = one(sp.assign);
  const [counts, rows, pool, studentRes] = await Promise.all([
    cardCounts(ctx),
    listCards(ctx, { status, q }),
    unassignedCards(ctx),
    listStudents(ctx, { status: "active", pageSize: 200, sort: "enrollment", q: one(sp.sq) }),
  ]);
  const base = `/c/${slug}/admin/cards`;
  const here = qs(base, { status, q });
  const nextYear = `${new Date().getFullYear() + 1}-06-30`;

  return (
    <>
      <PageHeader title="Digital ID & NFC cards" description="Register physical cards, link them to students, and control the URL each card opens." />
      <Flash searchParams={flashOf(sp)} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active" value={counts.active} tone="ok" href={qs(base, { status: "active" })} />
        <Stat label="Inactive" value={counts.inactive} href={qs(base, { status: "inactive" })} />
        <Stat label="Unassigned stock" value={counts.unassigned} href={qs(base, { status: "unassigned" })} />
        <Stat label="Lost / damaged / revoked" value={counts.revoked} tone={counts.revoked ? "warn" : "default"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Assign a card to a student" className="lg:col-span-2">
          {pool.length === 0 ? (
            <EmptyState title="No unassigned cards in stock" description="Register card serials first." />
          ) : (
            <form action={assignCardAction} className="grid gap-4 sm:grid-cols-3">
              <TenantFields slug={slug} back={here} />
              <Field label="Card">
                <Select name="cardId" required options={pool.map((c) => ({ value: c.id, label: c.serial }))} />
              </Field>
              <Field label="Student" hint={studentRes.total > 200 ? "Showing first 200 — search on the student page to narrow." : undefined}>
                <Select name="studentId" required defaultValue={assignFor ?? ""} placeholder="Choose student" options={studentRes.rows.map((r) => ({ value: r.student.id, label: `${r.student.enrollmentNo} · ${r.student.fullName}` }))} />
              </Field>
              <Field label="Valid until">
                <Input type="date" name="validUntil" defaultValue={nextYear} />
              </Field>
              <div className="sm:col-span-3">
                <SubmitButton>Assign & issue URL</SubmitButton>
              </div>
            </form>
          )}
        </Card>
        <Card title="Register new cards" description="One serial / chip UID per line. Cards never store student data.">
          <form action={registerCardsAction} className="space-y-3">
            <TenantFields slug={slug} back={here} />
            <Textarea name="serials" rows={4} placeholder={"NFC-000101\nNFC-000102"} required className="font-mono" aria-label="Card serials" />
            <SubmitButton variant="secondary">Register</SubmitButton>
          </form>
        </Card>
      </div>

      <Card className="mt-6" padded={false}>
        <form className="flex flex-wrap gap-3 border-b border-line p-4" role="search">
          <Input name="q" defaultValue={q} placeholder="Serial, enrollment no. or name" className="max-w-xs" aria-label="Search cards" />
          <Select name="status" defaultValue={status} options={["all", "active", "inactive", "unassigned", "lost", "damaged", "revoked"].map((s) => ({ value: s, label: s === "all" ? "All statuses" : s }))} className="w-auto" aria-label="Status" />
          <button className="rounded-lg border border-line px-3 text-sm hover:bg-surface-2">Filter</button>
        </form>
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No cards found" />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Serial</Th>
                <Th>Status</Th>
                <Th>Student</Th>
                <Th>Assigned</Th>
                <Th>Valid until</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.card.id} className="hover:bg-surface-2/50">
                  <Td className="font-mono text-xs">{r.card.serial}</Td>
                  <Td>
                    <StatusBadge status={r.card.status} />
                  </Td>
                  <Td>{r.enrollmentNo ? `${r.enrollmentNo} · ${r.studentName}` : <span className="text-muted">—</span>}</Td>
                  <Td>{formatDate(r.card.assignedAt)}</Td>
                  <Td>{formatDate(r.card.validUntil)}</Td>
                  <Td>
                    <Link href={`${base}/${r.card.id}`} className="font-medium text-brand hover:underline">
                      Manage
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
