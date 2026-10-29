import Link from "next/link";
import { Badge, Card, Checkbox, EmptyState, Field, Flash, Input, PageHeader, Select, Table, Td, TenantFields, Textarea, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { formatDateTime, nowMs } from "@/lib/format";
import { flashOf, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { actionableClasses } from "@/server/services/academics";
import { listCourseworkForStaff } from "@/server/services/coursework";
import { createCourseworkAction } from "@/server/actions/admin";

export const metadata = { title: "Assignments & materials" };

export default async function CourseworkPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const ctx = await requireTenant(slug, "coursework.manage");
  const [rows, classes] = await Promise.all([listCourseworkForStaff(ctx), actionableClasses(ctx)]);
  const base = `/c/${slug}/admin/coursework`;
  const now = nowMs();
  return (
    <>
      <PageHeader title="Assignments & study materials" description="Files are stored privately and served only to students of the class." />
      <Flash searchParams={flashOf(await searchParams)} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Publish to a class" className="lg:col-span-2">
          {classes.length === 0 ? (
            <EmptyState title="No classes assigned to you" />
          ) : (
            <form action={createCourseworkAction} encType="multipart/form-data" className="space-y-3">
              <TenantFields slug={slug} back={base} />
              <Field label="Class">
                <Select name="class" required options={classes.map((c) => ({ value: `${c.subjectId}:${c.sectionId}`, label: `${c.subjectCode} · ${c.programmeCode} Sem ${c.semester}-${c.sectionName}` }))} />
              </Field>
              <Field label="Type">
                <Select name="kind" options={[{ value: "assignment", label: "Assignment" }, { value: "material", label: "Study material / notes" }]} />
              </Field>
              <Field label="Title">
                <Input name="title" required />
              </Field>
              <Field label="Instructions / notes">
                <Textarea name="instructions" rows={4} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Due (assignments)">
                  <Input type="datetime-local" name="dueAt" />
                </Field>
                <Field label="Max marks">
                  <Input type="number" name="maxMarks" min={1} max={1000} />
                </Field>
              </div>
              <Field label="Attachment" hint="PDF, DOCX, PPTX, JPEG or PNG · max 4 MB">
                <Input type="file" name="attachment" accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png" />
              </Field>
              <Checkbox name="acceptSubmissions" defaultChecked label="Accept online submissions" />
              <SubmitButton>Publish</SubmitButton>
            </form>
          )}
        </Card>
        <Card className="lg:col-span-3" padded={false}>
          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Nothing published yet" />
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Title</Th>
                  <Th>Class</Th>
                  <Th>Due</Th>
                  <Th>Submissions</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.item.id}>
                    <Td>
                      <Link href={`${base}/${r.item.id}`} className="font-medium hover:underline">
                        {r.item.title}
                      </Link>
                      <div className="mt-0.5 flex gap-1">
                        <Badge tone={r.item.kind === "assignment" ? "amber" : "blue"}>{r.item.kind}</Badge>
                        {r.attachments > 0 && <Badge>file</Badge>}
                        {r.item.dueAt && r.item.dueAt.getTime() < now && <Badge tone="gray">closed</Badge>}
                      </div>
                    </Td>
                    <Td>
                      {r.subjectCode} · {r.programmeCode} {r.semester}-{r.sectionName}
                    </Td>
                    <Td className="text-xs">{r.item.dueAt ? formatDateTime(r.item.dueAt) : "—"}</Td>
                    <Td className="tabular-nums">{r.item.kind === "assignment" ? r.submissions : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
