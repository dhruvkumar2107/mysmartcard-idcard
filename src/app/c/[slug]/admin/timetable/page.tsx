import Link from "next/link";
import { Download } from "lucide-react";
import { Badge, Card, EmptyState, Field, Flash, Input, LinkButton, PageHeader, Select, StatusBadge, Tabs, TenantFields } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ImageDropInput } from "@/components/media";
import { formatDate, formatDateTime } from "@/lib/format";
import { flashOf, one, qs, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { listStructure, sectionLabel } from "@/server/services/academics";
import { upcomingEvents } from "@/server/services/timetable";
import { listTimetableImages, TIMETABLE_KINDS } from "@/server/services/timetable-images";
import { addEventAction, removeEventAction, timetableImageStatusAction, uploadTimetableImageAction } from "@/server/actions/admin";

export const metadata = { title: "Timetable" };

export default async function TimetablePage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug);
  const manage = ctx.perms.has("timetable.manage");
  const base = `/c/${slug}/admin/timetable`;
  const archived = manage && one(sp.view) === "archived";
  const [rows, s, events] = await Promise.all([listTimetableImages(ctx, { archived }), listStructure(ctx), upcomingEvents(ctx, undefined, 30)]);
  const here = qs(base, { view: archived ? "archived" : undefined });

  const op = (id: string, action: string, label: string, confirm?: string) => (
    <form action={timetableImageStatusAction}>
      <TenantFields slug={slug} back={here} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton variant={action === "delete" ? "ghost" : "secondary"} className={`px-2.5 py-1 text-xs ${action === "delete" ? "text-danger" : ""}`} confirm={confirm}>
        {label}
      </SubmitButton>
    </form>
  );

  return (
    <>
      <PageHeader title="Timetable" description={manage ? "Upload the timetable as an image. Students of the matching department, programme, semester and section see it in their portal with zoom and download." : "Published timetables."} />
      <Flash searchParams={flashOf(sp)} />
      {manage && (
        <Tabs
          tabs={[
            { key: "current", label: "Timetables" },
            { key: "archived", label: "Archived" },
          ]}
          active={archived ? "archived" : "current"}
          makeHref={(k) => (k === "archived" ? `${base}?view=archived` : base)}
        />
      )}

      <div className={manage && !archived ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]" : ""}>
        <div>
          {rows.length === 0 ? (
            <EmptyState title={archived ? "No archived timetables" : "No timetables uploaded yet"} description={manage && !archived ? "Upload a JPG, PNG or WebP of the timetable using the form." : undefined} />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {rows.map((r) => (
                <li key={r.t.id} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
                  <Link href={manage ? `${base}/${r.t.id}` : `/api/files/${r.file.id}`} className="block bg-surface-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/files/${r.file.id}`} alt={r.t.title} loading="lazy" className="aspect-[4/3] w-full object-cover object-top" />
                  </Link>
                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={r.t.status} />
                      <Badge tone={r.t.kind === "exam" ? "amber" : "blue"}>{r.t.kind === "exam" ? "Exam" : "Class"}</Badge>
                      {r.t.academicYear && <Badge>{r.t.academicYear}</Badge>}
                    </div>
                    <h3 className="mt-2 font-semibold">{r.t.title}</h3>
                    <p className="mt-1 text-xs text-muted">
                      For: {[r.department ?? "All departments", r.programme, r.t.semester ? `Sem ${r.t.semester}` : "all semesters", r.section ? `Section ${r.section}` : r.t.semester ? "all sections" : null].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      Updated {formatDateTime(r.t.updatedAt)}
                      {r.updatedBy ? ` by ${r.updatedBy}` : ""}
                    </p>
                    <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                      <a href={`/api/files/${r.file.id}?download=1`} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:bg-surface-2">
                        <Download className="h-3.5 w-3.5" aria-hidden /> Download
                      </a>
                      {manage && (
                        <>
                          <LinkButton href={`${base}/${r.t.id}`} className="px-2.5 py-1 text-xs">
                            Edit / replace
                          </LinkButton>
                          {r.t.status === "published" && op(r.t.id, "unpublish", "Unpublish")}
                          {r.t.status === "draft" && op(r.t.id, "publish", "Publish")}
                          {r.t.status === "archived" ? op(r.t.id, "restore", "Restore") : op(r.t.id, "archive", "Archive", "Archive this timetable? Students will no longer see it.")}
                          {op(r.t.id, "delete", "Delete", "Delete this timetable and all its image versions permanently?")}
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {manage && !archived && (
          <Card title="Upload a timetable" className="self-start xl:sticky xl:top-20">
            <form action={uploadTimetableImageAction} encType="multipart/form-data" className="space-y-3">
              <TenantFields slug={slug} back={here} />
              <Field label="Title">
                <Input name="title" required maxLength={160} placeholder="B.Tech CSE Sem 3 — Section A" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Type">
                  <Select name="kind" options={TIMETABLE_KINDS.map((k) => ({ value: k.key, label: k.label }))} />
                </Field>
                <Field label="Academic year">
                  <Input name="academicYear" placeholder="2026-27" maxLength={20} />
                </Field>
              </div>
              <Field label="Department">
                <Select name="departmentId" placeholder="All departments" options={s.departments.map((d) => ({ value: d.id, label: `${d.code} – ${d.name}` }))} />
              </Field>
              <Field label="Programme">
                <Select name="programmeId" placeholder="All programmes" options={s.programmes.map((p) => ({ value: p.id, label: p.code }))} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Semester">
                  <Select name="semester" placeholder="All" options={Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: `Semester ${i + 1}` }))} />
                </Field>
                <Field label="Section">
                  <Select name="sectionId" placeholder="All" options={s.sections.map((x) => ({ value: x.section.id, label: sectionLabel(x) }))} />
                </Field>
              </div>
              <ImageDropInput name="image" required label="Drop the timetable image here" />
              <div className="flex gap-2">
                <SubmitButton name="intent" value="publish" pendingLabel="Uploading…">
                  Upload & publish
                </SubmitButton>
                <SubmitButton name="intent" value="draft" variant="secondary" pendingLabel="Uploading…">
                  Save draft
                </SubmitButton>
              </div>
            </form>
          </Card>
        )}
      </div>

      {manage && !archived && (
        <Card title="Holidays, schedule changes & deadlines" padded={false} className="mt-6">
          <form action={addEventAction} className="grid gap-3 border-b border-line p-4 sm:grid-cols-3">
            <TenantFields slug={slug} back={here} />
            <Field label="Title">
              <Input name="title" required />
            </Field>
            <Field label="Type">
              <Select name="kind" options={[{ value: "holiday", label: "Holiday" }, { value: "schedule_change", label: "Schedule change" }, { value: "deadline", label: "Academic deadline" }, { value: "event", label: "Event" }]} />
            </Field>
            <Field label="Applies to">
              <Select name="sectionId" placeholder="Whole college" options={s.sections.map((x) => ({ value: x.section.id, label: sectionLabel(x) }))} />
            </Field>
            <Field label="From">
              <Input type="date" name="startDate" required />
            </Field>
            <Field label="To (optional)">
              <Input type="date" name="endDate" />
            </Field>
            <Field label="Details">
              <Input name="description" />
            </Field>
            <div>
              <SubmitButton variant="secondary">Add</SubmitButton>
            </div>
          </form>
          {events.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No upcoming entries" />
            </div>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                  <span>
                    <span className="font-medium">{e.title}</span> <Badge tone={e.kind === "holiday" ? "violet" : "amber"}>{e.kind.replace("_", " ")}</Badge>
                    <span className="block text-xs text-muted">
                      {formatDate(e.startDate)}
                      {e.endDate ? ` – ${formatDate(e.endDate)}` : ""}
                    </span>
                  </span>
                  <form action={removeEventAction}>
                    <TenantFields slug={slug} back={here} />
                    <input type="hidden" name="id" value={e.id} />
                    <SubmitButton variant="ghost" className="px-2 py-1 text-xs text-danger">
                      Remove
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}