import { Badge, Card, Flash, Input, PageHeader, Table, Td, TenantFields, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { formatDateTime } from "@/lib/format";
import { flashOf, type SlugProps } from "@/lib/page";
import { orNotFound, requireTenant } from "@/server/session";
import { submissionsFor } from "@/server/services/coursework";
import { gradeSubmissionAction } from "@/server/actions/admin";

export const metadata = { title: "Submissions" };

export default async function SubmissionsPage({ params, searchParams }: SlugProps<{ id: string }>) {
  const { slug, id } = await params;
  const ctx = await requireTenant(slug, "coursework.manage");
  const d = await orNotFound(submissionsFor(ctx, id));
  const back = `/c/${slug}/admin/coursework/${id}`;
  const submitted = d.rows.filter((r) => r.submission).length;
  return (
    <>
      <PageHeader
        title={d.coursework.title}
        description={`${d.subject.code} · ${submitted}/${d.rows.length} submitted${d.coursework.dueAt ? ` · due ${formatDateTime(d.coursework.dueAt)}` : ""}`}
        back={{ href: `/c/${slug}/admin/coursework`, label: "Assignments" }}
      />
      <Flash searchParams={flashOf(await searchParams)} />
      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Student</Th>
              <Th>Submission</Th>
              <Th>Grade & feedback</Th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  <span className="font-mono text-xs">{r.enrollmentNo}</span> {r.fullName}
                </Td>
                <Td>
                  {r.submission ? (
                    <span className="text-sm">
                      {r.submission.fileId && (
                        <a href={`/api/files/${r.submission.fileId}`} className="font-medium text-brand hover:underline">
                          Download
                        </a>
                      )}{" "}
                      <span className="text-xs text-muted">{formatDateTime(r.submission.submittedAt)}</span>
                      {d.coursework.dueAt && r.submission.submittedAt > d.coursework.dueAt && <Badge tone="red">Late</Badge>}
                      {r.submission.note && <span className="block text-xs text-muted">“{r.submission.note}”</span>}
                    </span>
                  ) : (
                    <Badge tone={d.coursework.dueAt && d.coursework.dueAt < new Date() ? "red" : "gray"}>Not submitted</Badge>
                  )}
                </Td>
                <Td>
                  {r.submission && (
                    <form action={gradeSubmissionAction} className="flex flex-wrap gap-2">
                      <TenantFields slug={slug} back={back} />
                      <input type="hidden" name="id" value={r.submission.id} />
                      <Input name="grade" type="number" min={0} max={d.coursework.maxMarks ?? 1000} defaultValue={r.submission.grade ?? ""} placeholder="Grade" className="w-20 py-1.5 text-xs" aria-label="Grade" />
                      <Input name="feedback" defaultValue={r.submission.feedback ?? ""} placeholder="Feedback" className="w-56 py-1.5 text-xs" aria-label="Feedback" />
                      <SubmitButton variant="secondary" className="py-1.5 text-xs">
                        Save
                      </SubmitButton>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
