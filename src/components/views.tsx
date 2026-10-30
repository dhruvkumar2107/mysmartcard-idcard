import Link from "next/link";
import { AlertTriangle, Bus, Clock, MapPin, Paperclip, Phone } from "lucide-react";
import { ASSESSMENT_CATEGORIES } from "@/lib/academics";
import { formatDate, formatDateTime, formatMoney, initials, nowMs, titleCase } from "@/lib/format";
import type { studentAttendance } from "@/server/services/attendance";
import type { publishedResultsForStudent } from "@/server/services/assessments";
import type { studentLedger } from "@/server/services/finance";
import type { loansForStudent, renewalEligibility } from "@/server/services/library";
import type { transportForStudent } from "@/server/services/transport";
import type { upcomingEvents } from "@/server/services/timetable";
import type { timetableImagesForStudent } from "@/server/services/timetable-images";
import type { examSchedule } from "@/server/services/assessments";
import type { noticesForStudent } from "@/server/services/notices";
import type { courseworkForStudent } from "@/server/services/coursework";
import { Alert, Badge, Card, EmptyState, Meter, StatusBadge, Table, Td, Th, cn } from "./ui";
import { Gallery, ImageViewer } from "./media";
import { RichText, plainPreview } from "./rich-text";

type A<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

const EXAM_CATS = new Set(["internal", "midterm", "end_semester"]);
const catLabel = (k: string) => ASSESSMENT_CATEGORIES.find((c) => c.key === k)?.label ?? titleCase(k);

// ---------------------------------------------------------------- Digital ID

export function DigitalIdCard({
  college,
  student,
  photoUrl,
  card,
  brand,
  details,
}: {
  college: { name: string; logoUrl?: string | null };
  student: { fullName: string; enrollmentNo: string; department?: string | null; programme?: string | null; semester?: number | string | null; academicYear?: string | null; status: string; bloodGroup?: string | null };
  photoUrl: string | null;
  card?: { status: string; validUntil: string | null } | null;
  brand: string;
  /** Extra label/value rows shown below the card body. */
  details?: [string, string][];
}) {
  return (
    <div className="mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-surface shadow-lg">
      <div className="flex items-center gap-3 px-5 py-4 text-white" style={{ background: `linear-gradient(135deg, ${brand}, color-mix(in srgb, ${brand} 70%, black))` }}>
        {college.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={college.logoUrl} alt="" className="h-9 w-9 rounded-md bg-white object-contain p-0.5" />
        ) : null}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{college.name}</div>
          <div className="text-[11px] uppercase tracking-wider text-white/70">Student identity card</div>
        </div>
      </div>
      <div className="flex gap-4 px-5 py-5">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt={`Photograph of ${student.fullName}`} className="h-28 w-24 shrink-0 rounded-lg border border-line object-cover" />
        ) : (
          <div className="grid h-28 w-24 shrink-0 place-items-center rounded-lg bg-surface-2 text-2xl font-semibold text-muted" aria-hidden>
            {initials(student.fullName)}
          </div>
        )}
        <div className="min-w-0 space-y-1.5">
          <div className="text-lg font-semibold leading-tight">{student.fullName}</div>
          <div className="font-mono text-sm">{student.enrollmentNo}</div>
          {student.programme && <div className="text-sm text-muted">{student.programme}</div>}
          {student.department && <div className="text-xs text-muted">{student.department}</div>}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <StatusBadge status={student.status} />
            {student.semester && <Badge tone="blue">Sem {student.semester}</Badge>}
            {student.academicYear && <Badge>{student.academicYear}</Badge>}
            {student.bloodGroup && <Badge tone="red">{student.bloodGroup}</Badge>}
          </div>
        </div>
      </div>
      {details && details.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line px-5 py-4">
          {details.map(([k, v]) => (
            <div key={k} className={cn("min-w-0", v.length > 24 && "col-span-2")}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">{k}</dt>
              <dd className="mt-0.5 break-words text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {card && (
        <div className="flex items-center justify-between border-t border-line bg-surface-2/50 px-5 py-2.5 text-xs">
          <span>
            NFC card <StatusBadge status={card.status} />
          </span>
          <span className="text-muted">Valid until {formatDate(card.validUntil)}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Attendance

export function AttendanceView({ data }: { data: A<typeof studentAttendance> }) {
  const o = data.overall;
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">Overall attendance</div>
            <div className={cn("text-4xl font-semibold tabular-nums", o.shortage ? "text-danger" : "text-ok")}>{o.percentage === null ? "—" : `${o.percentage}%`}</div>
          </div>
          <div className="grid grid-cols-3 gap-6 text-center text-sm">
            <div>
              <div className="text-lg font-semibold tabular-nums">{o.conducted}</div>
              <div className="text-muted">Conducted</div>
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums text-ok">{o.attended}</div>
              <div className="text-muted">Attended</div>
            </div>
            <div>
              <div className="text-lg font-semibold tabular-nums text-danger">{o.absent}</div>
              <div className="text-muted">Absent</div>
            </div>
          </div>
        </div>
        <div className="mt-4">
          <Meter value={o.percentage} threshold={data.threshold} />
          <div className="mt-1 text-xs text-muted">Minimum required: {data.threshold}%</div>
        </div>
        {o.shortage && (
          <div className="mt-4">
            <Alert tone="danger">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-4 w-4" aria-hidden /> Attendance shortage
              </span>{" "}
              — attend the next {o.classesNeeded} class(es) without absence to reach {data.threshold}%.
            </Alert>
          </div>
        )}
      </Card>
      <Card title="Subject-wise" padded={false}>
        {data.subjects.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No attendance recorded yet" />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {data.subjects.map((s) => (
              <li key={s.subjectId} className="px-5 py-3">
                <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{s.code}</span> <span className="text-muted">{s.name}</span>
                  </span>
                  <span className={cn("shrink-0 font-semibold tabular-nums", s.shortage ? "text-danger" : "")}>
                    {s.percentage ?? "—"}% <span className="font-normal text-muted">({s.attended}/{s.conducted})</span>
                  </span>
                </div>
                <Meter value={s.percentage} threshold={data.threshold} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Date-wise history" padded={false}>
        {data.history.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No sessions yet" />
          </div>
        ) : (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {data.history.map((h, i) => (
              <li key={i} className="flex items-center justify-between px-5 py-2 text-sm">
                <span>
                  <span className="tabular-nums">{formatDate(h.date)}</span> <span className="text-muted">· P{h.period} · {h.code}</span>
                </span>
                <StatusBadge status={h.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Results

export function ResultsView({ data, showCgpa }: { data: A<typeof publishedResultsForStudent>; showCgpa: boolean }) {
  const exams = data.assessments.filter((a) => EXAM_CATS.has(a.category));
  if (!data.semesters.length && !exams.length) return <EmptyState title="No published results yet" description="Results appear here once the examination cell publishes them." />;
  return (
    <div className="space-y-5">
      {showCgpa && (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card>
          <div className="text-xs font-medium uppercase tracking-wide text-muted">CGPA</div>
          <div className="text-3xl font-semibold tabular-nums">{data.cgpa ?? "—"}</div>
          <div className="text-xs text-muted">Credit-weighted, published marks only</div>
        </Card>
        {data.semesters.map((s) => (
          <Card key={s.semester}>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">Semester {s.semester} SGPA</div>
            <div className="text-3xl font-semibold tabular-nums">{s.sgpa ?? "—"}</div>
            <div className="text-xs text-muted">{s.credits} credits</div>
          </Card>
        ))}
      </div>
      )}
      {data.semesters.map((sem) => (
        <Card key={sem.semester} title={`Semester ${sem.semester} — subject performance`} padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Subject</Th>
                <Th>Credits</Th>
                <Th>Marks</Th>
                <Th>%</Th>
                <Th>Grade</Th>
                <Th>Points</Th>
              </tr>
            </thead>
            <tbody>
              {sem.subjects.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <span className="font-medium">{r.code}</span> <span className="text-muted">{r.name}</span>
                  </Td>
                  <Td>{r.credits}</Td>
                  <Td className="tabular-nums">
                    {r.obtained} / {r.max}
                  </Td>
                  <Td className="tabular-nums">{r.percentage}</Td>
                  <Td>
                    <Badge tone={r.passed ? "green" : "red"}>{r.grade}</Badge>
                  </Td>
                  <Td className="tabular-nums">{r.point}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ))}
      <AssessmentTable title="Examinations" rows={exams} />
    </div>
  );
}

export function InternalMarksView({ data }: { data: A<typeof publishedResultsForStudent> }) {
  const rows = data.assessments.filter((a) => !EXAM_CATS.has(a.category));
  if (!rows.length) return <EmptyState title="No published practical or internal marks yet" />;
  const groups = [...new Set(rows.map((r) => r.category))];
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <AssessmentTable key={g} title={catLabel(g)} rows={rows.filter((r) => r.category === g)} />
      ))}
    </div>
  );
}

function AssessmentTable({ title, rows }: { title: string; rows: A<typeof publishedResultsForStudent>["assessments"] }) {
  if (!rows.length) return null;
  return (
    <Card title={title} padded={false}>
      <Table>
        <thead>
          <tr>
            <Th>Subject</Th>
            <Th>Assessment</Th>
            <Th>Date</Th>
            <Th>Marks</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.assessmentId}>
              <Td>
                <span className="font-medium">{r.subjectCode}</span>
              </Td>
              <Td>{r.name}</Td>
              <Td>{formatDate(r.examDate)}</Td>
              <Td className="tabular-nums">{r.isAbsent ? <Badge tone="red">Absent</Badge> : `${r.obtained} / ${r.maxMarks}`}</Td>
              <Td>
                <StatusBadge status="published" />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

// ---------------------------------------------------------------- Timetable

export function TimetableView({ images, events, exams, fileHref, downloadHref }: { images: A<typeof timetableImagesForStudent>; events: A<typeof upcomingEvents>; exams: A<typeof examSchedule>; fileHref: (id: string) => string; downloadHref: (id: string) => string }) {
  const classTt = images.filter((i) => i.t.kind === "class");
  const examTt = images.filter((i) => i.t.kind === "exam");
  return (
    <div className="space-y-6">
      {classTt.length === 0 ? (
        <EmptyState title="No timetable published yet" description="Your class timetable appears here as soon as the college uploads it for your department, semester and section." />
      ) : (
        classTt.map((i) => <TimetableImageCard key={i.t.id} item={i} fileHref={fileHref} downloadHref={downloadHref} />)
      )}
      {examTt.map((i) => (
        <TimetableImageCard key={i.t.id} item={i} fileHref={fileHref} downloadHref={downloadHref} />
      ))}
      {events.length > 0 && (
        <Card title="Holidays & schedule changes" padded={false}>
          <ul className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{e.title}</span>
                  {e.description && <span className="block text-xs text-muted">{e.description}</span>}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block tabular-nums">{formatDate(e.startDate)}</span>
                  <Badge tone={e.kind === "holiday" ? "violet" : "amber"}>{e.kind.replace("_", " ")}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {exams.length > 0 && (
        <Card title="Upcoming examinations" padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Time</Th>
                <Th>Subject</Th>
                <Th>Examination</Th>
                <Th>Venue</Th>
              </tr>
            </thead>
            <tbody>
              {exams.map((e) => (
                <tr key={e.assessment.id}>
                  <Td className="tabular-nums">{formatDate(e.assessment.examDate)}</Td>
                  <Td className="tabular-nums">{e.assessment.startTime ? `${e.assessment.startTime}–${e.assessment.endTime ?? ""}` : "TBA"}</Td>
                  <Td>
                    <span className="font-medium">{e.subjectCode}</span> <span className="text-muted">{e.subjectName}</span>
                  </Td>
                  <Td>{e.assessment.name}</Td>
                  <Td>{e.assessment.room ?? "TBA"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function TimetableImageCard({ item, fileHref, downloadHref }: { item: A<typeof timetableImagesForStudent>[number]; fileHref: (id: string) => string; downloadHref: (id: string) => string }) {
  const t = item.t;
  return (
    <section aria-label={t.title}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{t.title}</h2>
        <Badge tone={t.kind === "exam" ? "amber" : "blue"}>{t.kind === "exam" ? "Examination timetable" : "Class timetable"}</Badge>
        {t.academicYear && <Badge>{t.academicYear}</Badge>}
        <span className="text-xs text-muted">Updated {formatDate(t.updatedAt)}</span>
      </div>
      <ImageViewer src={fileHref(item.file.id)} alt={t.title} downloadHref={downloadHref(item.file.id)} />
    </section>
  );
}

// ---------------------------------------------------------------- Notices

type NoticeLike = A<typeof noticesForStudent>[number] & { unread?: boolean };

/** Notice feed card: image, title, preview, date, category and an unread dot. */
export function NoticeCard({ n, href, fileHref }: { n: NoticeLike; href?: string; fileHref: (id: string) => string }) {
  const body = (
    <article className={cn("group flex h-full flex-col overflow-hidden rounded-2xl border bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition", href && "hover:-translate-y-0.5 hover:shadow-md", n.unread ? "border-brand/40" : "border-line")}>
      {n.imageFileId && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileHref(n.imageFileId)} alt="" loading="lazy" className="aspect-[16/9] w-full bg-surface-2 object-cover" style={{ objectPosition: n.imagePosition }} />
      )}
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {n.unread && (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden /> New
            </span>
          )}
          {n.pinned && <Badge tone="violet">Pinned</Badge>}
          <Badge tone="blue">{titleCase(n.category)}</Badge>
        </div>
        <h3 className={cn("leading-snug", n.unread ? "font-semibold" : "font-medium")}>{n.title}</h3>
        <p className="mt-1.5 line-clamp-3 text-sm text-muted">{plainPreview(n.body)}</p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-xs text-muted">
          <time dateTime={n.publishAt?.toISOString()}>{formatDate(n.publishAt)}</time>
          {n.attachments.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Paperclip className="h-3.5 w-3.5" aria-hidden /> {n.attachments.length}
            </span>
          )}
        </div>
      </div>
    </article>
  );
  return href ? (
    <Link href={href} className="block h-full rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label={`${n.title}${n.unread ? " (unread)" : ""}`}>
      {body}
    </Link>
  ) : (
    body
  );
}

export function NoticesView({ notices, fileHref, hrefFor }: { notices: NoticeLike[]; fileHref: (id: string) => string; hrefFor?: (id: string) => string }) {
  if (!notices.length) return <EmptyState title="No notices" description="Announcements from your college appear here." />;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {notices.map((n) => (
        <li key={n.id}>
          <NoticeCard n={n} href={hrefFor?.(n.id)} fileHref={fileHref} />
        </li>
      ))}
    </ul>
  );
}

/** Full notice: image, formatted text and attachments. */
export function NoticeDetail({ n, fileHref }: { n: NoticeLike; fileHref: (id: string) => string }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface">
      {n.imageFileId && (
        <a href={fileHref(n.imageFileId)} target="_blank" rel="noopener" className="block bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fileHref(n.imageFileId)} alt="Notice image" className="mx-auto max-h-[70vh] w-full object-contain" />
        </a>
      )}
      <div className="p-5 sm:p-7">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {n.pinned && <Badge tone="violet">Pinned</Badge>}
          <Badge tone="blue">{titleCase(n.category)}</Badge>
          <time className="text-xs text-muted" dateTime={n.publishAt?.toISOString()}>
            Published {formatDateTime(n.publishAt)}
          </time>
        </div>
        <h1 className="text-xl font-semibold leading-snug sm:text-2xl">{n.title}</h1>
        <RichText text={n.body} className="mt-4 text-[15px] leading-relaxed text-ink/90" />
        {n.attachments.length > 0 && (
          <ul className="mt-5 flex flex-wrap gap-2">
            {n.attachments.map((a) => (
              <li key={a.id}>
                <a href={fileHref(a.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm hover:bg-surface-2">
                  <Paperclip className="h-4 w-4" aria-hidden /> {a.name}
                </a>
              </li>
            ))}
          </ul>
        )}
        {n.expiresAt && <p className="mt-4 text-xs text-muted">Visible until {formatDateTime(n.expiresAt)}</p>}
      </div>
    </article>
  );
}

// ---------------------------------------------------------------- Coursework

/**
 * Assignment gallery. Due dates appear only when the server left them in the data
 * (i.e. the super admin enabled assignment deadlines for this college).
 */
export function CourseworkView({ items, fileHref, submitSlot }: { items: A<typeof courseworkForStudent>; fileHref: (id: string) => string; submitSlot?: (item: A<typeof courseworkForStudent>[number]) => React.ReactNode }) {
  if (!items.length) return <EmptyState title="No assignments yet" description="Assignments and study material from your teachers appear here." />;
  const now = nowMs();
  return (
    <ul className="space-y-4">
      {items.map((i) => {
        const images = i.attachments.filter((a) => a.mimeType.startsWith("image/"));
        const docs = i.attachments.filter((a) => !a.mimeType.startsWith("image/"));
        const overdue = i.item.kind === "assignment" && !i.submission && i.item.dueAt && i.item.dueAt.getTime() < now;
        return (
          <li key={i.item.id}>
            <article className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={i.item.kind === "assignment" ? "amber" : "blue"}>{i.item.kind === "assignment" ? "Assignment" : "Study material"}</Badge>
                <span className="text-xs font-medium text-muted">
                  {i.subjectCode} · {i.subjectName}
                </span>
                {overdue && <Badge tone="red">Overdue</Badge>}
                {i.submission && <Badge tone="green">Submitted {formatDate(i.submission.submittedAt)}</Badge>}
              </div>
              <h3 className="mt-2 text-base font-semibold">{i.item.title}</h3>
              {i.item.instructions && <p className="mt-1 whitespace-pre-line text-sm text-ink/80">{i.item.instructions}</p>}
              {images.length > 0 && (
                <Gallery className="mt-3" images={images.map((a, n) => ({ id: a.id, src: fileHref(a.id), downloadHref: `${fileHref(a.id)}?download=1`, alt: `${i.item.title} — image ${n + 1}` }))} />
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span>Published {formatDate(i.item.createdAt)}</span>
                {i.publisher && <span>By {i.publisher}</span>}
                {i.item.dueAt && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" aria-hidden /> Due {formatDateTime(i.item.dueAt)}
                  </span>
                )}
                {docs.map((a) => (
                  <a key={a.id} href={fileHref(a.id)} className="inline-flex items-center gap-1 text-brand hover:underline">
                    <Paperclip className="h-3.5 w-3.5" aria-hidden /> {a.name}
                  </a>
                ))}
              </div>
              {i.submission?.grade != null && (
                <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                  Grade: <strong>{i.submission.grade}</strong>
                  {i.item.maxMarks ? ` / ${i.item.maxMarks}` : ""}
                  {i.submission.feedback && <span className="block text-muted">Feedback: {i.submission.feedback}</span>}
                </div>
              )}
              {submitSlot?.(i)}
            </article>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- Fees

export function FeesView({ ledger, receiptHref, showDue }: { ledger: A<typeof studentLedger>; receiptHref: (id: string) => string; showDue: boolean }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <div className="text-xs uppercase tracking-wide text-muted">Payable</div>
          <div className="text-xl font-semibold tabular-nums">{formatMoney(ledger.payable)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-muted">Paid</div>
          <div className="text-xl font-semibold tabular-nums text-ok">{formatMoney(ledger.paid)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase tracking-wide text-muted">Outstanding</div>
          <div className={cn("text-xl font-semibold tabular-nums", ledger.balance > 0 && "text-danger")}>{formatMoney(Math.max(0, ledger.balance))}</div>
        </Card>
      </div>
      <Card title="Fee items" padded={false}>
        {ledger.demands.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No fees raised" />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Category</Th>
                <Th>Description</Th>
                {showDue && <Th>Due date</Th>}
                <Th>Amount</Th>
                <Th>Paid</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {ledger.demands.map((d) => (
                <tr key={d.id}>
                  <Td>{titleCase(d.category)}</Td>
                  <Td>{d.description ?? "—"}</Td>
                  {showDue && <Td className="tabular-nums">{formatDate(d.dueDate)}</Td>}
                  <Td className="tabular-nums">{formatMoney(d.amount)}</Td>
                  <Td className="tabular-nums">{formatMoney(d.paid)}</Td>
                  <Td>
                    <StatusBadge status={d.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Card title="Payment history" padded={false}>
        {ledger.payments.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No payments recorded" />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Receipt</Th>
                <Th>Date</Th>
                <Th>Method</Th>
                <Th>Amount</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {ledger.payments.map((p) => (
                <tr key={p.id}>
                  <Td className="font-mono text-xs">{p.receiptNo}</Td>
                  <Td className="tabular-nums">{formatDate(p.paidAt)}</Td>
                  <Td>{titleCase(p.method)}</Td>
                  <Td className="tabular-nums">{formatMoney(p.amount)}</Td>
                  <Td>
                    <a href={receiptHref(p.id)} className="text-sm font-medium text-brand hover:underline">
                      Receipt
                    </a>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="text-xs text-muted">Pay at the accounts office or by the bank details shared by your college. Receipts appear here once the accounts office records the payment.</p>
    </div>
  );
}

// ---------------------------------------------------------------- Library

export function LibraryView({ loans }: { loans: (A<typeof loansForStudent>[number] & { renewal: ReturnType<typeof renewalEligibility> })[] }) {
  if (!loans.length) return <EmptyState title="No library records" description="Books issued to you by the library appear here." />;
  const fines = loans.filter((l) => l.loan.fineAmount > 0 && !l.loan.finePaid).reduce((s, l) => s + l.loan.fineAmount, 0);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      {fines > 0 && <Alert tone="warn">Outstanding library fines: {formatMoney(fines)}. Please clear them at the library desk.</Alert>}
      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Book</Th>
              <Th>Issued</Th>
              <Th>Due</Th>
              <Th>Status</Th>
              <Th>Renewal</Th>
              <Th>Fine</Th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l) => (
              <tr key={l.loan.id}>
                <Td>
                  <div className="font-medium">{l.title}</div>
                  <div className="text-xs text-muted">
                    {l.author ?? ""} · {l.accessionNo}
                    {l.isbn ? ` · ISBN ${l.isbn}` : ""}
                  </div>
                </Td>
                <Td className="tabular-nums">{formatDate(l.loan.issuedAt)}</Td>
                <Td className="tabular-nums">{formatDate(l.loan.dueAt)}</Td>
                <Td>{l.loan.returnedAt ? <StatusBadge status="returned" /> : l.loan.dueAt < today ? <StatusBadge status="overdue" /> : <Badge tone="blue">On loan</Badge>}</Td>
                <Td className="text-xs text-muted">{l.renewal.reason}</Td>
                <Td className="tabular-nums">{l.loan.fineAmount ? `${formatMoney(l.loan.fineAmount)}${l.loan.finePaid ? " (paid)" : ""}` : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- Transport

export function TransportView({ transport }: { transport: A<typeof transportForStudent> }) {
  if (!transport) return <EmptyState title="No transport assigned" description="Contact the transport office to register for a college bus route." />;
  const { route, stop, stops } = transport;
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
            <Bus className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold">
              Route {route.code} · {route.name}
            </div>
            {!route.active && <Badge tone="red">Route currently inactive</Badge>}
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <div>Vehicle: {route.vehicleNo ?? "—"}</div>
              <div>Driver: {route.driverName ?? "—"}</div>
              {route.contactPhone && (
                <a href={`tel:${route.contactPhone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-brand">
                  <Phone className="h-4 w-4" aria-hidden /> {route.contactPhone}
                </a>
              )}
            </div>
          </div>
        </div>
        {stop && (
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg bg-surface-2 p-3 text-sm">
            <div>
              <div className="text-xs text-muted">Your stop</div>
              <div className="font-medium">{stop.name}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Pickup</div>
              <div className="font-semibold tabular-nums">{stop.pickupTime}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Drop-off</div>
              <div className="font-semibold tabular-nums">{stop.dropTime}</div>
            </div>
          </div>
        )}
      </Card>
      <Card title="Route stops" padded={false}>
        <ol className="divide-y divide-line">
          {stops.map((s) => (
            <li key={s.id} className={cn("flex items-center justify-between px-5 py-2.5 text-sm", stop?.id === s.id && "bg-brand/5 font-medium")}>
              <span className="inline-flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted" aria-hidden /> {s.sequence}. {s.name}
              </span>
              <span className="tabular-nums text-muted">
                {s.pickupTime} / {s.dropTime}
              </span>
            </li>
          ))}
        </ol>
      </Card>
      <p className="text-xs text-muted">Live GPS tracking is not enabled for this college.</p>
    </div>
  );
}
