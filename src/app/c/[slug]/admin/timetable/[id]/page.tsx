import { Badge, Card, Field, Flash, Input, PageHeader, Select, StatusBadge, TenantFields } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ImageDropInput, ImageViewer } from "@/components/media";
import { formatDateTime } from "@/lib/format";
import { flashOf, type SlugProps } from "@/lib/page";
import { orNotFound, requireTenant } from "@/server/session";
import { listStructure, sectionLabel } from "@/server/services/academics";
import { TIMETABLE_KINDS, timetableImage } from "@/server/services/timetable-images";
import { timetableImageStatusAction, updateTimetableImageAction } from "@/server/actions/admin";

export const metadata = { title: "Edit timetable" };

export default async function TimetableDetail({ params, searchParams }: SlugProps<{ id: string }>) {
  const { slug, id } = await params;
  const ctx = await requireTenant(slug, "timetable.manage");
  const [{ t, versions }, s] = await Promise.all([orNotFound(timetableImage(ctx, id)), listStructure(ctx)]);
  const back = `/c/${slug}/admin/timetable/${t.id}`;
  const status = (action: string, label: string, variant: "primary" | "secondary" = "secondary", confirm?: string) => (
    <form action={timetableImageStatusAction}>
      <TenantFields slug={slug} back={back} />
      <input type="hidden" name="id" value={t.id} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton variant={variant} confirm={confirm}>
        {label}
      </SubmitButton>
    </form>
  );
  return (
    <>
      <PageHeader
        title={t.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} /> <Badge tone={t.kind === "exam" ? "amber" : "blue"}>{t.kind === "exam" ? "Examination timetable" : "Class timetable"}</Badge> Last updated {formatDateTime(t.updatedAt)}
          </span>
        }
        back={{ href: `/c/${slug}/admin/timetable`, label: "Timetables" }}
        actions={
          <>
            {t.status !== "published" && status("publish", "Publish", "primary")}
            {t.status === "published" && status("unpublish", "Unpublish")}
            {t.status !== "archived" && status("archive", "Archive", "secondary", "Archive this timetable? Students will no longer see it.")}
          </>
        }
      />
      <Flash searchParams={flashOf(await searchParams)} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <ImageViewer src={`/api/files/${t.fileId}`} alt={t.title} downloadHref={`/api/files/${t.fileId}?download=1`} />
        <div className="space-y-6">
          <Card title="Details & replace image">
            <form action={updateTimetableImageAction} encType="multipart/form-data" className="space-y-3">
              <TenantFields slug={slug} back={back} />
              <input type="hidden" name="id" value={t.id} />
              <Field label="Title">
                <Input name="title" required maxLength={160} defaultValue={t.title} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <Select name="kind" defaultValue={t.kind} options={TIMETABLE_KINDS.map((k) => ({ value: k.key, label: k.label }))} />
                </Field>
                <Field label="Academic year">
                  <Input name="academicYear" defaultValue={t.academicYear ?? ""} maxLength={20} />
                </Field>
              </div>
              <Field label="Department">
                <Select name="departmentId" defaultValue={t.departmentId ?? ""} placeholder="All departments" options={s.departments.map((d) => ({ value: d.id, label: `${d.code} – ${d.name}` }))} />
              </Field>
              <Field label="Programme">
                <Select name="programmeId" defaultValue={t.programmeId ?? ""} placeholder="All programmes" options={s.programmes.map((p) => ({ value: p.id, label: p.code }))} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Semester">
                  <Select name="semester" defaultValue={t.semester ? String(t.semester) : ""} placeholder="All" options={Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: `Semester ${i + 1}` }))} />
                </Field>
                <Field label="Section">
                  <Select name="sectionId" defaultValue={t.sectionId ?? ""} placeholder="All" options={s.sections.map((x) => ({ value: x.section.id, label: sectionLabel(x) }))} />
                </Field>
              </div>
              <Field label="Replace image (optional)">
                <ImageDropInput name="image" label="Drop a new version to replace the current image" />
              </Field>
              <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
            </form>
          </Card>
          <Card title="Upload history" description="Every uploaded version is kept. Students only ever see the current one." padded={false}>
            <ul className="divide-y divide-line text-sm">
              {versions.map((v) => (
                <li key={v.file.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {v.file.originalName} {v.file.id === t.fileId && <Badge tone="green">Current</Badge>}
                    </span>
                    <span className="text-xs text-muted">
                      {formatDateTime(v.file.createdAt)}
                      {v.uploadedBy ? ` · ${v.uploadedBy}` : ""} · {(v.file.sizeBytes / 1024).toFixed(0)} KB
                    </span>
                  </span>
                  <a href={`/api/files/${v.file.id}?download=1`} className="shrink-0 text-xs font-medium text-brand hover:underline">
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </Card>
          <form action={timetableImageStatusAction} className="text-right">
            <TenantFields slug={slug} back={back} />
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="action" value="delete" />
            <SubmitButton variant="ghost" className="text-danger" confirm="Delete this timetable and all its image versions permanently?">
              Delete timetable
            </SubmitButton>
          </form>
        </div>
      </div>
    </>
  );
}