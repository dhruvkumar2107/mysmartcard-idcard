import { Alert, Card, Flash, Input, PageHeader, StatusBadge, TenantFields } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { ASSESSMENT_CATEGORIES } from "@/lib/academics";
import { formatDate, formatDateTime } from "@/lib/format";
import { flashOf, type SlugProps } from "@/lib/page";
import { orNotFound, requireTenant } from "@/server/session";
import { marksSheet } from "@/server/services/assessments";
import { enterMarksAction, transitionAssessmentAction } from "@/server/actions/admin";

export const metadata = { title: "Marks entry" };

export default async function MarksPage({ params, searchParams }: SlugProps<{ id: string }>) {
  const { slug, id } = await params;
  const ctx = await requireTenant(slug);
  const sheet = await orNotFound(marksSheet(ctx, id));
  const a = sheet.assessment;
  const back = `/c/${slug}/admin/exams/${id}`;
  const editable = a.status === "draft" && ctx.perms.has("marks.enter") && !ctx.viaSupport;
  const entered = sheet.rows.filter((r) => r.mark).length;
  const present = sheet.rows.filter((r) => r.mark && !r.mark.isAbsent);
  const avg = present.length ? Math.round((present.reduce((s, r) => s + (r.mark!.marksObtained ?? 0), 0) / present.length) * 10) / 10 : null;

  const step = (to: string, label: string, opts: { variant?: "primary" | "secondary" | "danger"; confirm?: string; reason?: boolean } = {}) => (
    <form action={transitionAssessmentAction} className="flex gap-2">
      <TenantFields slug={slug} back={back} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="to" value={to} />
      {opts.reason && <Input name="reason" placeholder="Reason for reopening" required className="w-56" aria-label="Reason" />}
      <SubmitButton variant={opts.variant ?? "primary"} confirm={opts.confirm}>
        {label}
      </SubmitButton>
    </form>
  );

  return (
    <>
      <PageHeader
        title={a.name}
        description={`${sheet.subject.code} ${sheet.subject.name} · ${ASSESSMENT_CATEGORIES.find((c) => c.key === a.category)?.label} · max ${a.maxMarks} · ${formatDate(a.examDate)}`}
        back={{ href: `/c/${slug}/admin/exams`, label: "Exams" }}
        actions={<StatusBadge status={a.status} />}
      />
      <Flash searchParams={flashOf(await searchParams)} />

      <Card title="Workflow" className="mb-6">
        <ol className="mb-4 flex flex-wrap gap-2 text-xs">
          {["draft", "submitted", "approved", "published"].map((s, i) => (
            <li key={s} className={`rounded-full px-3 py-1 ${s === a.status ? "bg-brand text-white" : "bg-surface-2 text-muted"}`}>
              {i + 1}. {s}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-3">
          {a.status === "draft" && ctx.perms.has("marks.enter") && step("submitted", "Submit for approval", { confirm: "Submit marks? They will be locked until an approver acts." })}
          {a.status === "submitted" && ctx.perms.has("results.approve") && step("approved", "Approve marks")}
          {a.status === "submitted" && step("draft", "Return to draft", { variant: "secondary" })}
          {a.status === "approved" && ctx.perms.has("results.publish") && step("published", "Publish to students", { confirm: "Publish these results? Students will see them immediately." })}
          {a.status === "approved" && ctx.perms.has("results.publish") && step("draft", "Send back for correction", { variant: "secondary" })}
          {a.status === "published" && ctx.perms.has("results.publish") && step("draft", "Reopen for correction", { variant: "danger", reason: true, confirm: "Reopening hides these results from students until re-published. Continue?" })}
        </div>
        {a.publishedAt && <p className="mt-3 text-xs text-muted">Published {formatDateTime(a.publishedAt)}</p>}
      </Card>

      <div className="mb-4 flex gap-6 text-sm">
        <span>
          Entered: <strong className="tabular-nums">{entered}</strong> / {sheet.rows.length}
        </span>
        <span>
          Average: <strong className="tabular-nums">{avg ?? "—"}</strong>
        </span>
        <span>
          Absent: <strong className="tabular-nums">{sheet.rows.filter((r) => r.mark?.isAbsent).length}</strong>
        </span>
      </div>

      {!editable && a.status !== "draft" && <div className="mb-4"><Alert tone="info">Marks are locked while the assessment is {a.status}. Reopen it to make corrections — every change is audited.</Alert></div>}

      <Card padded={false}>
        <form action={enterMarksAction}>
          <TenantFields slug={slug} back={back} />
          <input type="hidden" name="id" value={id} />
          <ul className="divide-y divide-line">
            {sheet.rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="text-sm">
                  <span className="font-mono text-xs text-muted">{r.enrollmentNo}</span> <span className="font-medium">{r.fullName}</span>
                </span>
                <Input
                  name={`m_${r.id}`}
                  defaultValue={r.mark ? (r.mark.isAbsent ? "AB" : String(r.mark.marksObtained ?? "")) : ""}
                  disabled={!editable}
                  inputMode="decimal"
                  pattern="(AB|ab|\d+(\.\d{1,2})?)"
                  placeholder={`0–${a.maxMarks} or AB`}
                  className="w-32 text-right tabular-nums"
                  aria-label={`Marks for ${r.fullName}`}
                />
              </li>
            ))}
          </ul>
          {editable && (
            <div className="flex justify-end border-t border-line p-4">
              <SubmitButton>Save marks</SubmitButton>
            </div>
          )}
        </form>
      </Card>
    </>
  );
}
