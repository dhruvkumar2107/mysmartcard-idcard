import { Badge, Card, Field, Flash, Input, PageHeader, StatusBadge, Table, Tabs, Td, TenantFields, Textarea, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { Gallery, ImageDropInput } from "@/components/media";
import { formatDateTime } from "@/lib/format";
import { flashOf, one, type SlugProps } from "@/lib/page";
import { orNotFound, requireTenant } from "@/server/session";
import { courseworkDetail, submissionsFor } from "@/server/services/coursework";
import { addCourseworkImagesAction, courseworkStatusAction, gradeSubmissionAction, removeCourseworkFileAction, updateCourseworkAction } from "@/server/actions/admin";

export const metadata = { title: "Assignment" };

/** dueAt as a datetime-local value (server time). */
function local(d: Date | null) {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function CourseworkDetailPage({ params, searchParams }: SlugProps<{ id: string }>) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "coursework.manage");
  const d = await orNotFound(courseworkDetail(ctx, id));
  const cw = d.coursework;
  const tab = one(sp.tab) === "submissions" ? "submissions" : "manage";
  const base = `/c/${slug}/admin/coursework/${id}`;
  const back = `${base}?tab=${tab}`;
  const subs = tab === "submissions" ? await submissionsFor(ctx, id) : null;
  const images = d.attachments.filter((a) => a.mimeType.startsWith("image/"));
  const docs = d.attachments.filter((a) => !a.mimeType.startsWith("image/"));
  const status = (action: string, label: string, variant: "primary" | "secondary" | "ghost" = "secondary", confirm?: string) => (
    <form action={courseworkStatusAction}>
      <TenantFields slug={slug} back={back} />
      <input type="hidden" name="id" value={cw.id} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton variant={variant} confirm={confirm} className={action === "delete" ? "text-danger" : undefined}>
        {label}
      </SubmitButton>
    </form>
  );

  return (
    <>
      <PageHeader
        title={cw.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={cw.status} />
            <span>
              {d.subject.code} · {d.section?.programmeCode} Sem {d.section?.semester}-{d.section?.name}
              {d.author ? ` · by ${d.author}` : ""} · updated {formatDateTime(cw.updatedAt)}
            </span>
          </span>
        }
        back={{ href: `/c/${slug}/admin/coursework`, label: "Assignments" }}
        actions={
          <>
            {cw.status !== "published" && status("publish", cw.status === "archived" ? "Restore & publish" : "Publish", "primary")}
            {cw.status === "published" && status("unpublish", "Unpublish")}
            {cw.status !== "archived" && status("archive", "Archive", "secondary", "Archive this assignment? Students will no longer see it; records are kept.")}
          </>
        }
      />
      <Flash searchParams={flashOf(sp)} />
      <Tabs
        tabs={[
          { key: "manage", label: "Assignment" },
          ...(cw.kind === "assignment" ? [{ key: "submissions", label: "Submissions" }] : []),
        ]}
        active={tab}
        makeHref={(k) => `${base}?tab=${k}`}
      />

      {tab === "manage" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="space-y-6">
            <Card title="How students see it" description="Students see the title, subject, description, images and publication date. No deadline is shown unless assignment deadlines are enabled for your college.">
              <h3 className="text-base font-semibold">{cw.title}</h3>
              {cw.instructions && <p className="mt-1 whitespace-pre-line text-sm text-ink/80">{cw.instructions}</p>}
              {images.length > 0 ? (
                <Gallery className="mt-3" images={images.map((a, n) => ({ id: a.id, src: `/api/files/${a.id}`, downloadHref: `/api/files/${a.id}?download=1`, alt: `${cw.title} — image ${n + 1}` }))} />
              ) : (
                <p className="mt-3 text-sm text-muted">No images yet.</p>
              )}
            </Card>
            <Card title="Images & files" padded={false}>
              <ul className="divide-y divide-line text-sm">
                {[...images, ...docs].map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="flex min-w-0 items-center gap-3">
                      {a.mimeType.startsWith("image/") && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/files/${a.id}`} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate">{a.originalName}</span>
                        <span className="text-xs text-muted">
                          {(a.sizeBytes / 1024).toFixed(0)} KB · {formatDateTime(a.createdAt)}
                        </span>
                      </span>
                    </span>
                    <form action={removeCourseworkFileAction}>
                      <TenantFields slug={slug} back={back} />
                      <input type="hidden" name="id" value={cw.id} />
                      <input type="hidden" name="fileId" value={a.id} />
                      <SubmitButton variant="ghost" className="px-2 py-1 text-xs text-danger" confirm="Remove this image?">
                        Remove
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
              <form action={addCourseworkImagesAction} encType="multipart/form-data" className="space-y-3 border-t border-line p-4">
                <TenantFields slug={slug} back={back} />
                <input type="hidden" name="id" value={cw.id} />
                <ImageDropInput name="images" multiple required maxFiles={12} label="Add more images (or replacements)" />
                <SubmitButton variant="secondary" pendingLabel="Uploading…">
                  Upload images
                </SubmitButton>
              </form>
            </Card>
          </div>
          <div className="space-y-6">
            <Card title="Details">
              <form action={updateCourseworkAction} className="space-y-3">
                <TenantFields slug={slug} back={back} />
                <input type="hidden" name="id" value={cw.id} />
                <Field label="Title">
                  <Input name="title" required maxLength={200} defaultValue={cw.title} />
                </Field>
                <Field label="Short description">
                  <Textarea name="instructions" rows={4} maxLength={5000} defaultValue={cw.instructions ?? ""} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Deadline (admin)" hint="Hidden from students by default">
                    <Input type="datetime-local" name="dueAt" defaultValue={local(cw.dueAt)} />
                  </Field>
                  <Field label="Max marks">
                    <Input type="number" name="maxMarks" min={1} max={1000} defaultValue={cw.maxMarks ?? ""} />
                  </Field>
                </div>
                <SubmitButton>Save</SubmitButton>
              </form>
            </Card>
            <div className="text-right">{status("delete", "Delete assignment", "ghost", "Delete this assignment permanently? Assignments with student submissions can only be archived.")}</div>
          </div>
        </div>
      )}

      {tab === "submissions" && subs && (
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
              {subs.rows.map((r) => (
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
                        {cw.dueAt && r.submission.submittedAt > cw.dueAt && <Badge tone="red">Late</Badge>}
                        {r.submission.note && <span className="block text-xs text-muted">“{r.submission.note}”</span>}
                      </span>
                    ) : (
                      <Badge tone="gray">Not submitted</Badge>
                    )}
                  </Td>
                  <Td>
                    {r.submission && (
                      <form action={gradeSubmissionAction} className="flex flex-wrap gap-2">
                        <TenantFields slug={slug} back={back} />
                        <input type="hidden" name="id" value={r.submission.id} />
                        <Input name="grade" type="number" min={0} max={cw.maxMarks ?? 1000} defaultValue={r.submission.grade ?? ""} placeholder="Grade" className="w-20 py-1.5 text-xs" aria-label="Grade" />
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
      )}
    </>
  );
}