import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { Badge, Card, EmptyState, Field, Flash, Input, PageHeader, Select, StatusBadge, Tabs, TenantFields, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ImageDropInput } from "@/components/media";
import { formatDateTime } from "@/lib/format";
import { flashOf, one, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { actionableClasses } from "@/server/services/academics";
import { listCourseworkForStaff } from "@/server/services/coursework";
import { createCourseworkAction } from "@/server/actions/admin";

export const metadata = { title: "Assignments & materials" };

export default async function CourseworkPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "coursework.manage");
  const [all, classes] = await Promise.all([listCourseworkForStaff(ctx), actionableClasses(ctx)]);
  const base = `/c/${slug}/admin/coursework`;
  const view = one(sp.view) === "archived" ? "archived" : "current";
  const rows = all.filter((r) => (view === "archived" ? r.item.status === "archived" : r.item.status !== "archived"));
  return (
    <>
      <PageHeader title="Assignments & study material" description="Assignments are shared as photos. Students see them in an image gallery with zoom and download; deadlines stay in this admin view." />
      <Flash searchParams={flashOf(sp)} />
      <Tabs
        tabs={[
          { key: "current", label: "Assignments" },
          { key: "archived", label: "Archived" },
        ]}
        active={view}
        makeHref={(k) => (k === "archived" ? `${base}?view=archived` : base)}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div>
          {rows.length === 0 ? (
            <EmptyState title={view === "archived" ? "Nothing archived" : "Nothing published yet"} />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {rows.map((r) => (
                <li key={r.item.id}>
                  <Link href={`${base}/${r.item.id}`} className="flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface transition hover:-translate-y-0.5 hover:shadow-md">
                    {r.cover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/files/${r.cover}`} alt="" loading="lazy" className="aspect-[16/9] w-full bg-surface-2 object-cover" />
                    ) : (
                      <div className="grid aspect-[16/9] place-items-center bg-surface-2 text-muted">
                        <ImageIcon className="h-8 w-8" aria-hidden />
                      </div>
                    )}
                    <div className="flex flex-1 flex-col p-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={r.item.status} />
                        <Badge tone={r.item.kind === "assignment" ? "amber" : "blue"}>{r.item.kind === "assignment" ? "Assignment" : "Material"}</Badge>
                        {r.images > 0 && <Badge>{r.images} image{r.images > 1 ? "s" : ""}</Badge>}
                      </div>
                      <h3 className="mt-2 font-semibold">{r.item.title}</h3>
                      <p className="mt-1 text-xs text-muted">
                        {r.subjectCode} · {r.programmeCode} Sem {r.semester}-{r.sectionName}
                      </p>
                      <p className="mt-auto pt-2 text-xs text-muted">
                        Published {formatDateTime(r.item.createdAt)}
                        {r.item.dueAt ? ` · deadline (admin) ${formatDateTime(r.item.dueAt)}` : ""}
                        {r.item.kind === "assignment" && r.submissions ? ` · ${r.submissions} submissions` : ""}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Card title="New assignment" className="self-start xl:sticky xl:top-20">
          {classes.length === 0 ? (
            <EmptyState title="No classes assigned to you" />
          ) : (
            <form action={createCourseworkAction} encType="multipart/form-data" className="space-y-3">
              <TenantFields slug={slug} back={base} />
              <Field label="Class (department · programme · semester · section · subject)">
                <Select name="class" required options={classes.map((c) => ({ value: `${c.subjectId}:${c.sectionId}`, label: `${c.subjectCode} · ${c.programmeCode} Sem ${c.semester}-${c.sectionName}` }))} />
              </Field>
              <input type="hidden" name="kind" value="assignment" />
              <Field label="Title">
                <Input name="title" required maxLength={200} placeholder="Unit 3 problem sheet" />
              </Field>
              <Field label="Short description">
                <Textarea name="instructions" rows={3} maxLength={5000} placeholder="What students should do with these pages" />
              </Field>
              <Field label="Assignment images">
                <ImageDropInput name="images" multiple required maxFiles={12} label="Drop assignment photos here" />
              </Field>
              <details className="rounded-lg border border-line p-3 text-sm">
                <summary className="cursor-pointer font-medium">Admin-only record (optional)</summary>
                <p className="mb-2 mt-1 text-xs text-muted">Deadlines are not shown to students unless MySmartCard enables assignment deadlines for your college.</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Deadline">
                    <Input type="datetime-local" name="dueAt" />
                  </Field>
                  <Field label="Max marks">
                    <Input type="number" name="maxMarks" min={1} max={1000} />
                  </Field>
                </div>
              </details>
              <div className="flex gap-2">
                <SubmitButton name="intent" value="publish" pendingLabel="Uploading…">
                  Publish
                </SubmitButton>
                <SubmitButton name="intent" value="draft" variant="secondary" pendingLabel="Uploading…">
                  Save draft
                </SubmitButton>
              </div>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}