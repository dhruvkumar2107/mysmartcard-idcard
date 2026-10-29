import Link from "next/link";
import { Download, Upload, UserPlus } from "lucide-react";
import { Card, EmptyState, Flash, Input, LinkButton, PageHeader, Pagination, Select, StatusBadge, Table, Td, TenantFields, Th } from "@/components/ui";
import { SelectAll, SubmitButton } from "@/components/client";
import { flashOf, one, qs, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { listStudents, STUDENT_STATUSES } from "@/server/services/students";
import { listStructure, sectionLabel } from "@/server/services/academics";
import { bulkStudentStatusAction } from "@/server/actions/admin";

export const metadata = { title: "Students" };

export default async function StudentsPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "students.view");
  const base = `/c/${slug}/admin/students`;
  const filters = {
    q: one(sp.q),
    status: one(sp.status),
    departmentId: one(sp.departmentId),
    programmeId: one(sp.programmeId),
    sectionId: one(sp.sectionId),
    semester: one(sp.semester) ? Number(one(sp.semester)) : undefined,
    sort: (one(sp.sort) as "name" | "enrollment" | "recent") ?? "name",
    page: Number(one(sp.page) ?? 1),
  };
  const [res, structure] = await Promise.all([listStudents(ctx, filters), listStructure(ctx)]);
  const can = (p: Parameters<typeof ctx.perms.has>[0]) => ctx.perms.has(p);
  const here = qs(base, { ...filters, page: filters.page > 1 ? filters.page : undefined });

  return (
    <>
      <PageHeader
        title="Students"
        description={ctx.scope.kind === "all" ? "All students in your college." : ctx.scope.kind === "department" ? "Students in your department." : "Students in the sections you teach."}
        actions={
          <>
            {can("students.export") && (
              <LinkButton href={qs(`/api/c/${slug}/students/export`, { ...filters, page: undefined })} prefetch={false}>
                <Download className="h-4 w-4" aria-hidden /> Export CSV
              </LinkButton>
            )}
            {can("students.import") && (
              <LinkButton href={`${base}/import`}>
                <Upload className="h-4 w-4" aria-hidden /> Import
              </LinkButton>
            )}
            {can("students.edit") && (
              <LinkButton href={`${base}/new`} variant="primary">
                <UserPlus className="h-4 w-4" aria-hidden /> Add student
              </LinkButton>
            )}
          </>
        }
      />
      <Flash searchParams={flashOf(sp)} />

      <Card padded={false}>
        <form className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-6" role="search">
          <Input name="q" defaultValue={filters.q} placeholder="Name, enrollment no., email" className="lg:col-span-2" aria-label="Search" />
          <Select name="departmentId" defaultValue={filters.departmentId ?? ""} placeholder="All departments" options={structure.departments.map((d) => ({ value: d.id, label: d.code }))} aria-label="Department" />
          <Select name="sectionId" defaultValue={filters.sectionId ?? ""} placeholder="All sections" options={structure.sections.map((s) => ({ value: s.section.id, label: sectionLabel(s) }))} aria-label="Section" />
          <Select name="status" defaultValue={filters.status ?? ""} placeholder="Current (not archived)" options={[{ value: "all", label: "All statuses" }, ...STUDENT_STATUSES.map((s) => ({ value: s, label: s }))]} aria-label="Status" />
          <div className="flex gap-2">
            <Select name="sort" defaultValue={filters.sort} options={[{ value: "name", label: "Sort: Name" }, { value: "enrollment", label: "Sort: Enrollment" }, { value: "recent", label: "Sort: Newest" }]} aria-label="Sort" />
            <button className="rounded-lg border border-line px-3 text-sm hover:bg-surface-2">Apply</button>
          </div>
        </form>

        {res.rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No students match" description="Adjust the filters, or add students individually or by import." action={can("students.edit") ? <LinkButton href={`${base}/new`} variant="primary">Add student</LinkButton> : undefined} />
          </div>
        ) : (
          <form action={bulkStudentStatusAction}>
            <TenantFields slug={slug} back={here} />
            {can("students.archive") && (
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-2/40 px-4 py-2 text-sm">
                <span className="text-muted">With selected:</span>
                <Select name="status" defaultValue="inactive" options={STUDENT_STATUSES.map((s) => ({ value: s, label: `Set ${s}` }))} className="w-auto py-1.5" aria-label="New status" />
                <SubmitButton variant="secondary" className="py-1.5" confirm="Apply this status change to all selected students? This is recorded in the audit log.">
                  Apply
                </SubmitButton>
              </div>
            )}
            <Table>
              <thead>
                <tr>
                  {can("students.archive") && (
                    <Th className="w-10">
                      <SelectAll name="ids" />
                    </Th>
                  )}
                  <Th>Student</Th>
                  <Th>Enrollment</Th>
                  <Th>Programme</Th>
                  <Th>Sem / Sec</Th>
                  <Th>Year</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {res.rows.map(({ student: s, departmentCode, programmeCode, sectionName }) => (
                  <tr key={s.id} className="hover:bg-surface-2/50">
                    {can("students.archive") && (
                      <Td>
                        <input type="checkbox" name="ids" value={s.id} aria-label={`Select ${s.fullName}`} className="h-4 w-4 accent-[var(--brand)]" />
                      </Td>
                    )}
                    <Td>
                      <Link href={`${base}/${s.id}`} className="font-medium hover:underline">
                        {s.fullName}
                      </Link>
                      <div className="text-xs text-muted">{s.email ?? "No email"}</div>
                    </Td>
                    <Td className="font-mono text-xs">{s.enrollmentNo}</Td>
                    <Td>
                      {programmeCode ?? "—"} <span className="text-muted">({departmentCode ?? "—"})</span>
                    </Td>
                    <Td>
                      {s.semester} / {sectionName ?? "—"}
                    </Td>
                    <Td>{s.academicYear}</Td>
                    <Td>
                      <StatusBadge status={s.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </form>
        )}
        <Pagination page={res.page} pages={res.pages} total={res.total} makeHref={(p) => qs(base, { ...filters, page: p })} />
      </Card>
    </>
  );
}
