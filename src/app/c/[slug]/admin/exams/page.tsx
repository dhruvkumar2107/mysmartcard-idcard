import Link from "next/link";
import { Card, EmptyState, Field, Flash, Input, PageHeader, Select, StatusBadge, Table, Tabs, Td, TenantFields, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ASSESSMENT_CATEGORIES } from "@/lib/academics";
import { formatDate } from "@/lib/format";
import { flashOf, one, qs, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { actionableClasses } from "@/server/services/academics";
import { listAssessments } from "@/server/services/assessments";
import { createAssessmentAction } from "@/server/actions/admin";

export const metadata = { title: "Exams & marks" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "pending", label: "Awaiting approval / publish" },
  { key: "published", label: "Published" },
];

export default async function ExamsPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug);
  const f = FILTERS.some((x) => x.key === one(sp.status)) ? one(sp.status)! : "all";
  const base = `/c/${slug}/admin/exams`;
  const [all, classes] = await Promise.all([listAssessments(ctx), actionableClasses(ctx)]);
  const rows = all.filter((r) => (f === "all" ? true : f === "pending" ? ["submitted", "approved"].includes(r.assessment.status) : r.assessment.status === f));

  return (
    <>
      <PageHeader title="Examinations & assessments" description="Create → enter marks → submit → approve → publish. Only published results reach students." />
      <Flash searchParams={flashOf(sp)} />
      {ctx.perms.has("assessments.manage") && classes.length > 0 && (
        <Card title="New examination or assessment" className="mb-6">
          <form action={createAssessmentAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <TenantFields slug={slug} back={base} />
            <Field label="Class" className="lg:col-span-2">
              <Select name="class" required placeholder="Choose" options={classes.map((c) => ({ value: `${c.subjectId}:${c.sectionId}`, label: `${c.subjectCode} · ${c.programmeCode} Sem ${c.semester}-${c.sectionName}` }))} />
            </Field>
            <Field label="Type">
              <Select name="category" options={ASSESSMENT_CATEGORIES.map((c) => ({ value: c.key, label: c.label }))} />
            </Field>
            <Field label="Name">
              <Input name="name" required placeholder="Internal Test 2" />
            </Field>
            <Field label="Maximum marks">
              <Input name="maxMarks" type="number" step="0.5" min={1} max={1000} required defaultValue={50} />
            </Field>
            <Field label="Date">
              <Input name="examDate" type="date" />
            </Field>
            <Field label="Time">
              <div className="flex gap-2">
                <Input name="startTime" type="time" aria-label="Start" />
                <Input name="endTime" type="time" aria-label="End" />
              </div>
            </Field>
            <Field label="Room / venue">
              <Input name="room" placeholder="Exam Hall 1" />
            </Field>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton>Create</SubmitButton>
            </div>
          </form>
        </Card>
      )}
      <Tabs tabs={FILTERS} active={f} makeHref={(k) => qs(base, { status: k === "all" ? undefined : k })} />
      <Card padded={false}>
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Nothing here" />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Assessment</Th>
                <Th>Class</Th>
                <Th>Date</Th>
                <Th>Marks entered</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.assessment.id} className="hover:bg-surface-2/50">
                  <Td>
                    <Link href={`${base}/${r.assessment.id}`} className="font-medium hover:underline">
                      {r.assessment.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {ASSESSMENT_CATEGORIES.find((c) => c.key === r.assessment.category)?.label} · max {r.assessment.maxMarks}
                    </div>
                  </Td>
                  <Td>
                    {r.subjectCode} · {r.programmeCode} Sem {r.semester}-{r.sectionName}
                  </Td>
                  <Td>{formatDate(r.assessment.examDate)}</Td>
                  <Td className="tabular-nums">
                    {r.entered}/{r.roster}
                  </Td>
                  <Td>
                    <StatusBadge status={r.assessment.status} />
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
