import { Alert, Badge, Card, EmptyState, Field, Flash, Input, PageHeader, Select, StatusBadge, Table, Td, TenantFields, Th, cn } from "@/components/ui";
import { MarkAll, SubmitButton } from "@/components/client";
import { ATTENDANCE_STATUSES } from "@/lib/academics";
import { formatDate, nowMs, todayISO } from "@/lib/format";
import { flashOf, one, qs, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { actionableClasses } from "@/server/services/academics";
import { attendanceSheet, pendingCorrections, recentSessions, sectionAttendanceReport } from "@/server/services/attendance";
import { markAttendanceAction, requestCorrectionAction, reviewCorrectionAction } from "@/server/actions/admin";

export const metadata = { title: "Attendance" };

export default async function AttendancePage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug);
  if (!ctx.perms.has("attendance.mark") && !ctx.perms.has("attendance.view_all")) return <Alert tone="danger">Your role cannot access attendance.</Alert>;
  const base = `/c/${slug}/admin/attendance`;
  const classes = await actionableClasses(ctx);
  const classId = one(sp.class);
  const date = one(sp.date) ?? todayISO();
  const period = Number(one(sp.period) ?? 1);
  const reportSection = one(sp.report);
  const here = qs(base, { class: classId, date, period, report: reportSection });

  const [sheet, recent, corrections, report] = await Promise.all([
    classId && ctx.perms.has("attendance.mark") ? attendanceSheet(ctx, classId, date, period) : null,
    recentSessions(ctx, 12),
    ctx.perms.has("attendance.approve") ? pendingCorrections(ctx) : [],
    reportSection && ctx.perms.has("attendance.view_all") ? sectionAttendanceReport(ctx, reportSection) : null,
  ]);
  const locked = !!sheet?.session && nowMs() - sheet.session.createdAt.getTime() > 48 * 36e5 && !ctx.perms.has("attendance.approve");
  const sectionOpts = [...new Map(classes.map((c) => [c.sectionId, `${c.programmeCode} · Sem ${c.semester}-${c.sectionName}`])).entries()].map(([value, label]) => ({ value, label }));

  return (
    <>
      <PageHeader title="Attendance" description={`Percentages follow your college rules: threshold ${ctx.academic.attendanceThreshold}%, late ${ctx.academic.lateCountsAsPresent ? "counts" : "does not count"} as present.`} />
      <Flash searchParams={flashOf(sp)} />

      {ctx.perms.has("attendance.mark") && (
        <Card title="Mark attendance" className="mb-6">
          {classes.length === 0 ? (
            <EmptyState title="No classes assigned to you" description="Ask your administrator to add a teaching assignment." />
          ) : (
            <form className="grid gap-3 sm:grid-cols-4">
              <Field label="Class" className="sm:col-span-2">
                <Select name="class" defaultValue={classId ?? ""} required placeholder="Choose a class" options={classes.map((c) => ({ value: c.id, label: `${c.subjectCode} · ${c.programmeCode} Sem ${c.semester}-${c.sectionName}${ctx.facultyId && c.facultyId !== ctx.facultyId ? ` (${c.facultyName})` : ""}` }))} />
              </Field>
              <Field label="Date">
                <Input type="date" name="date" defaultValue={date} max={todayISO()} required />
              </Field>
              <Field label="Period">
                <div className="flex gap-2">
                  <Input type="number" name="period" min={1} max={12} defaultValue={period} required />
                  <button className="rounded-lg border border-line px-3 text-sm hover:bg-surface-2">Open</button>
                </div>
              </Field>
            </form>
          )}
        </Card>
      )}

      {sheet && (
        <Card
          title={`${sheet.subject.code} · ${formatDate(date)} · Period ${period}`}
          description={sheet.session ? (locked ? "Locked — older than 48 hours. Request corrections per student below." : "Already recorded — you can update it.") : "New session"}
          className="mb-6"
          padded={false}
        >
          {sheet.rows.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No active students in this section" />
            </div>
          ) : locked ? (
            <Table>
              <thead>
                <tr>
                  <Th>Student</Th>
                  <Th>Recorded</Th>
                  <Th>Request correction</Th>
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <span className="font-mono text-xs">{r.enrollmentNo}</span> {r.fullName}
                    </Td>
                    <Td>{r.status ? <StatusBadge status={r.status} /> : "—"}</Td>
                    <Td>
                      {r.recordId && (
                        <form action={requestCorrectionAction} className="flex flex-wrap gap-2">
                          <TenantFields slug={slug} back={here} />
                          <input type="hidden" name="recordId" value={r.recordId} />
                          <Select name="toStatus" options={ATTENDANCE_STATUSES.filter((s) => s !== r.status).map((s) => ({ value: s, label: s }))} className="w-auto py-1.5 text-xs" aria-label="New status" />
                          <Input name="reason" placeholder="Reason" required minLength={5} className="w-48 py-1.5 text-xs" aria-label="Reason" />
                          <SubmitButton variant="secondary" className="py-1.5 text-xs">
                            Request
                          </SubmitButton>
                        </form>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <form action={markAttendanceAction}>
              <TenantFields slug={slug} back={here} />
              <input type="hidden" name="classAssignmentId" value={sheet.ca.id} />
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="period" value={period} />
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                <MarkAll status="present" label="All present" />
                <MarkAll status="absent" label="All absent" />
                <Input name="topic" placeholder="Topic covered (optional)" defaultValue={sheet.session?.topic ?? ""} className="ml-auto max-w-xs" aria-label="Topic" />
              </div>
              <ul className="divide-y divide-line">
                {sheet.rows.map((r) => (
                  <li key={r.id} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm">
                      <span className="font-mono text-xs text-muted">{r.enrollmentNo}</span> <span className="font-medium">{r.fullName}</span>
                    </span>
                    <fieldset className="flex gap-1" aria-label={`Attendance for ${r.fullName}`}>
                      {ATTENDANCE_STATUSES.map((s) => (
                        <label key={s} className="cursor-pointer">
                          <input type="radio" name={`s_${r.id}`} value={s} defaultChecked={(r.status ?? "present") === s} className="peer sr-only" required />
                          <span
                            className={cn(
                              "inline-block rounded-md border border-line px-2.5 py-1 text-xs capitalize peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent",
                              s === "present" && "peer-checked:border-emerald-600 peer-checked:bg-emerald-600",
                              s === "absent" && "peer-checked:border-red-600 peer-checked:bg-red-600",
                              s === "late" && "peer-checked:border-amber-500 peer-checked:bg-amber-500",
                              s === "excused" && "peer-checked:border-sky-600 peer-checked:bg-sky-600",
                            )}
                          >
                            {s}
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end border-t border-line p-4">
                <SubmitButton>Save attendance ({sheet.rows.length} students)</SubmitButton>
              </div>
            </form>
          )}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Recent sessions" padded={false}>
          {recent.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No sessions recorded yet" />
            </div>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {recent.map((r) => (
                <li key={r.session.id} className="flex justify-between px-5 py-2.5">
                  <a href={qs(base, { class: r.session.classAssignmentId, date: r.session.date, period: r.session.period })} className="hover:underline">
                    {r.subjectCode} · {formatDate(r.session.date)} · P{r.session.period}
                  </a>
                  <span className="tabular-nums text-muted">
                    {r.present}/{r.total} present
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {ctx.perms.has("attendance.approve") && (
          <Card title="Pending corrections" padded={false}>
            <div id="corrections" />
            {corrections.length === 0 ? (
              <div className="p-5">
                <EmptyState title="Nothing to review" />
              </div>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {corrections.map((c) => (
                  <li key={c.correction.id} className="px-5 py-3">
                    <div className="font-medium">
                      {c.enrollmentNo} {c.studentName} · {c.subjectCode} {formatDate(c.date)} P{c.period}
                    </div>
                    <div className="text-muted">
                      <StatusBadge status={c.correction.fromStatus} /> → <StatusBadge status={c.correction.toStatus} /> · “{c.correction.reason}” · by {c.requestedBy ?? "—"}
                    </div>
                    <form action={reviewCorrectionAction} className="mt-2 flex gap-2">
                      <TenantFields slug={slug} back={here} />
                      <input type="hidden" name="id" value={c.correction.id} />
                      <SubmitButton name="decision" value="approved" className="py-1.5 text-xs">
                        Approve
                      </SubmitButton>
                      <SubmitButton name="decision" value="rejected" variant="secondary" className="py-1.5 text-xs">
                        Reject
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {ctx.perms.has("attendance.view_all") && (
        <Card title="Section report" className="mt-6" padded={false}>
          <form className="flex flex-wrap gap-2 border-b border-line p-4">
            <Select name="report" defaultValue={reportSection ?? ""} placeholder="Choose section" options={sectionOpts} className="max-w-xs" aria-label="Section" />
            <button className="rounded-lg border border-line px-3 text-sm hover:bg-surface-2">Show</button>
          </form>
          {report &&
            (report.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No students" />
              </div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Student</Th>
                    <Th>Conducted</Th>
                    <Th>Attended</Th>
                    <Th>%</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.map((r) => (
                    <tr key={r.id}>
                      <Td>
                        <span className="font-mono text-xs">{r.enrollmentNo}</span> {r.fullName}
                      </Td>
                      <Td className="tabular-nums">{r.conducted}</Td>
                      <Td className="tabular-nums">{r.attended}</Td>
                      <Td className={cn("font-semibold tabular-nums", r.shortage && "text-danger")}>{r.percentage ?? "—"}</Td>
                      <Td>{r.shortage ? <Badge tone="red">Shortage</Badge> : <Badge tone="green">OK</Badge>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ))}
        </Card>
      )}
    </>
  );
}
