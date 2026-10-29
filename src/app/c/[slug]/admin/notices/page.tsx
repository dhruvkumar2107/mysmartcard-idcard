import { Alert, Badge, Card, Checkbox, EmptyState, Field, Flash, Input, PageHeader, Select, StatusBadge, TenantFields, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { formatDateTime, titleCase } from "@/lib/format";
import { flashOf, one, qs, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { adminNotices, NOTICE_CATEGORIES } from "@/server/services/notices";
import { listStructure, sectionLabel } from "@/server/services/academics";
import { createNoticeAction, noticeStatusAction } from "@/server/actions/admin";

export const metadata = { title: "Notice board" };

export default async function NoticesPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "notices.publish");
  const q = one(sp.q);
  const [rows, s] = await Promise.all([adminNotices(ctx, q), listStructure(ctx)]);
  const back = qs(`/c/${slug}/admin/notices`, { q });
  const hod = ctx.scope.kind === "department";
  const now = new Date();
  const multi = "min-h-24 w-full rounded-lg border border-line p-1 text-sm";

  const op = (id: string, action: string, label: string, confirm?: string) => (
    <form action={noticeStatusAction}>
      <TenantFields slug={slug} back={back} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton variant={action === "delete" ? "ghost" : "secondary"} className={`px-2.5 py-1 text-xs ${action === "delete" ? "text-danger" : ""}`} confirm={confirm}>
        {label}
      </SubmitButton>
    </form>
  );

  return (
    <>
      <PageHeader title="Notice board" description="Publish to the whole college or a targeted audience. Students only see live notices meant for them." />
      <Flash searchParams={flashOf(sp)} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="New notice" className="lg:col-span-2">
          <form action={createNoticeAction} encType="multipart/form-data" className="space-y-3">
            <TenantFields slug={slug} back={back} />
            <Field label="Title">
              <Input name="title" required maxLength={200} />
            </Field>
            <Field label="Message">
              <Textarea name="body" rows={5} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Select name="category" options={NOTICE_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) }))} />
              </Field>
              <Field label="Audience">
                <Select name="scope" defaultValue={hod ? "targeted" : "all"} options={hod ? [{ value: "targeted", label: "My department" }] : [{ value: "all", label: "Whole college" }, { value: "targeted", label: "Targeted (below)" }]} />
              </Field>
            </div>
            {!hod && (
              <details className="rounded-lg border border-line p-3">
                <summary className="cursor-pointer text-sm font-medium">Targeting filters</summary>
                <p className="mb-2 mt-1 text-xs text-muted">Filters combine (e.g. CSE + semester 3). Ctrl/Cmd-click to select several.</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Departments">
                    <select name="departmentIds" multiple className={multi}>
                      {s.departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Programmes">
                    <select name="programmeIds" multiple className={multi}>
                      {s.programmes.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Semesters">
                    <select name="semesters" multiple className={multi}>
                      {Array.from({ length: 8 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          Semester {n}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Sections">
                    <select name="sectionIds" multiple className={multi}>
                      {s.sections.map((x) => (
                        <option key={x.section.id} value={x.section.id}>
                          {sectionLabel(x)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </details>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Publish at (optional)">
                <Input type="datetime-local" name="publishAt" />
              </Field>
              <Field label="Expires (optional)">
                <Input type="datetime-local" name="expiresAt" />
              </Field>
            </div>
            <Field label="Attachment" hint="PDF, image or DOCX · max 4 MB">
              <Input type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,.docx,.pptx" />
            </Field>
            <div className="flex flex-wrap gap-4">
              <Checkbox name="pinned" label="Pin to top" />
              <Checkbox name="notifyEmail" label="Email recipients" />
            </div>
            {!process.env.EMAIL_PROVIDER && <Alert tone="warn">Email delivery is not configured for this deployment. Notices still appear in the portal; email requests are logged but not sent.</Alert>}
            <div className="flex gap-2">
              <SubmitButton name="intent" value="publish">
                Publish
              </SubmitButton>
              <SubmitButton name="intent" value="draft" variant="secondary">
                Save draft
              </SubmitButton>
            </div>
          </form>
        </Card>

        <div className="lg:col-span-3">
          <form className="mb-3" role="search">
            <Input name="q" defaultValue={q} placeholder="Search notices by title" aria-label="Search notices" />
          </form>
          {rows.length === 0 ? (
            <EmptyState title="No notices yet" />
          ) : (
            <ul className="space-y-3">
              {rows.map(({ notice: n, attachments }) => {
                const scheduled = n.status === "published" && n.publishAt && n.publishAt > now;
                const expired = n.expiresAt && n.expiresAt <= now;
                return (
                  <li key={n.id} className="rounded-xl border border-line bg-surface p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={n.status} />
                      {scheduled && <Badge tone="blue">Scheduled</Badge>}
                      {expired && <Badge tone="gray">Expired</Badge>}
                      {n.pinned && <Badge tone="violet">Pinned</Badge>}
                      <Badge>{titleCase(n.category)}</Badge>
                      <Badge tone="blue">{n.audience.scope === "all" ? "Whole college" : "Targeted"}</Badge>
                      {attachments > 0 && <Badge>{attachments} attachment</Badge>}
                    </div>
                    <h3 className="mt-2 font-semibold">{n.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-muted">{n.body}</p>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted">
                        {n.publishAt ? `Publishes ${formatDateTime(n.publishAt)}` : `Created ${formatDateTime(n.createdAt)}`}
                        {n.expiresAt ? ` · expires ${formatDateTime(n.expiresAt)}` : ""}
                      </span>
                      <div className="flex gap-1.5">
                        {n.status === "draft" ? op(n.id, "publish", "Publish") : op(n.id, "unpublish", "Unpublish")}
                        {n.pinned ? op(n.id, "unpin", "Unpin") : op(n.id, "pin", "Pin")}
                        {op(n.id, "delete", "Delete", "Delete this notice permanently?")}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
