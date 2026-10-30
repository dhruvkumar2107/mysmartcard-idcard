import Link from "next/link";
import { Eye, Pencil } from "lucide-react";
import { Alert, Card, EmptyState, Field, Flash, Input, KV, LinkButton, PageHeader, StatusBadge, Table, Tabs, Td, TenantFields, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { OneTimeCredential } from "@/components/server-bits";
import { AttendanceView, CourseworkView, DigitalIdCard, FeesView, InternalMarksView, LibraryView, NoticesView, ResultsView, TimetableView, TransportView } from "@/components/views";
import { formatDate, formatDateTime } from "@/lib/format";
import { flashOf, one, type SlugProps } from "@/lib/page";
import { orNotFound, requireTenant } from "@/server/session";
import { getStudent, portalAccessStatus, studentDocuments, studentHistory } from "@/server/services/students";
import { studentAttendance } from "@/server/services/attendance";
import { examSchedule, publishedResultsForStudent } from "@/server/services/assessments";
import { upcomingEvents } from "@/server/services/timetable";
import { timetableImagesForStudent } from "@/server/services/timetable-images";
import { noticesForStudent } from "@/server/services/notices";
import { courseworkForStudent } from "@/server/services/coursework";
import { studentLedger } from "@/server/services/finance";
import { loansForStudent, renewalEligibility } from "@/server/services/library";
import { transportForStudent } from "@/server/services/transport";
import { cardsForStudent } from "@/server/services/cards";
import { disablePortalAction, enablePortalAction, uploadDocumentAction, uploadPhotoAction } from "@/server/actions/admin";

export const metadata = { title: "Student profile" };

const TABS = [
  { key: "personal", label: "Personal" },
  { key: "academic", label: "Academic" },
  { key: "attendance", label: "Attendance" },
  { key: "results", label: "Results" },
  { key: "internal", label: "Practical & internal" },
  { key: "timetable", label: "Timetable" },
  { key: "notices", label: "Notices" },
  { key: "coursework", label: "Assignments" },
  { key: "fees", label: "Fees" },
  { key: "library", label: "Library" },
  { key: "transport", label: "Transport" },
  { key: "card", label: "NFC card" },
  { key: "documents", label: "Documents" },
  { key: "history", label: "Change history" },
];

export default async function StudentProfile({ params, searchParams }: SlugProps<{ id: string }>) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "students.view");
  const { student: s, department, programme, section } = await orNotFound(getStudent(ctx, id));
  const tab = TABS.some((t) => t.key === one(sp.tab)) ? one(sp.tab)! : "personal";
  const base = `/c/${slug}/admin/students/${id}`;
  const back = `${base}?tab=${tab}`;
  const can = (p: Parameters<typeof ctx.perms.has>[0]) => ctx.perms.has(p);
  const fileHref = (fid: string) => `/api/files/${fid}`;
  const tabs = TABS.filter((t) => (t.key === "fees" ? can("fees.view") : t.key === "history" ? can("audit.view") : t.key === "card" ? can("cards.manage") : true));
  const portal = await portalAccessStatus(ctx, s);
  const photoUrl = s.photoFileId ? fileHref(s.photoFileId) : null;

  return (
    <>
      <PageHeader
        title={s.fullName}
        description={
          <span className="font-mono">
            {s.enrollmentNo} · {programme?.code ?? "—"} · Sem {s.semester}
            {section ? `-${section.name}` : ""}
          </span>
        }
        back={{ href: `/c/${slug}/admin/students`, label: "Students" }}
        actions={
          <>
            {can("portal.configure") && (
              <LinkButton href={`/c/${slug}/admin/preview/${id}`}>
                <Eye className="h-4 w-4" aria-hidden /> Preview portal
              </LinkButton>
            )}
            {can("students.edit") && (
              <LinkButton href={`${base}/edit`} variant="primary">
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </LinkButton>
            )}
          </>
        }
      />
      <Flash searchParams={flashOf(sp)} />
      <OneTimeCredential />
      <Tabs tabs={tabs} active={tab} makeHref={(k) => `${base}?tab=${k}`} />

      {tab === "personal" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-4">
            <DigitalIdCard college={{ name: ctx.institution.name }} student={{ ...s, department: department?.name, programme: programme?.name }} photoUrl={photoUrl} brand={ctx.portalConfig.branding.primaryColor} />
            {can("students.edit") && (
              <Card title="Update photograph">
                <form action={uploadPhotoAction} encType="multipart/form-data" className="flex flex-col gap-3">
                  <TenantFields slug={slug} back={back} />
                  <input type="hidden" name="id" value={id} />
                  <Input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required aria-label="Photograph" />
                  <SubmitButton variant="secondary">Upload</SubmitButton>
                </form>
              </Card>
            )}
          </div>
          <div className="space-y-6 lg:col-span-2">
            <Card title="Personal information">
              <KV
                items={[
                  ["Full name", s.fullName],
                  ["Gender", s.gender],
                  ["Date of birth", can("students.view_sensitive") ? formatDate(s.dateOfBirth) : "Restricted"],
                  ["Blood group", s.bloodGroup],
                  ["Email", s.email],
                  ["Phone", s.phone],
                  ["Guardian", can("students.view_sensitive") ? s.guardianName : "Restricted"],
                  ["Guardian phone", can("students.view_sensitive") ? s.guardianPhone : "Restricted"],
                  ["Address", can("students.view_sensitive") ? s.address : "Restricted"],
                ]}
              />
            </Card>
            <Card title="Portal access" description="Students sign in to see their private records. The NFC card alone never grants access.">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  Status: <StatusBadge status={portal === "none" ? "inactive" : portal} /> {portal === "none" && <span className="text-muted">No account yet</span>}
                </div>
                {can("students.portal_access") && (
                  <div className="flex gap-2">
                    {portal !== "active" && (
                      <form action={enablePortalAction}>
                        <TenantFields slug={slug} back={back} />
                        <input type="hidden" name="id" value={id} />
                        <SubmitButton>{portal === "none" ? "Create portal account" : "Re-enable access"}</SubmitButton>
                      </form>
                    )}
                    {portal === "active" && (
                      <form action={disablePortalAction}>
                        <TenantFields slug={slug} back={back} />
                        <input type="hidden" name="id" value={id} />
                        <SubmitButton variant="danger" confirm="Disable this student's portal sign-in?">
                          Disable access
                        </SubmitButton>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "academic" && (
        <Card title="Academic information">
          <KV
            items={[
              ["Enrollment no.", <span key="e" className="font-mono">{s.enrollmentNo}</span>],
              ["Status", <StatusBadge key="s" status={s.status} />],
              ["Department", department ? `${department.code} – ${department.name}` : null],
              ["Programme", programme ? `${programme.code} – ${programme.name}` : null],
              ["Semester", s.semester],
              ["Section", section ? `${section.name} (${section.academicYear})` : null],
              ["Academic year", s.academicYear],
              ["Admission year", s.admissionYear],
              ["Record created", formatDateTime(s.createdAt)],
              ["Last updated", formatDateTime(s.updatedAt)],
            ]}
          />
        </Card>
      )}

      {tab === "attendance" && <AttendanceView data={await studentAttendance(ctx, id)} />}
      {tab === "results" && <ResultsView data={await publishedResultsForStudent(ctx, id)} showCgpa />}
      {tab === "internal" && <InternalMarksView data={await publishedResultsForStudent(ctx, id)} />}
      {tab === "timetable" && <TimetableView images={await timetableImagesForStudent(ctx, s)} events={await upcomingEvents(ctx, s.sectionId)} exams={await examSchedule(ctx, s.sectionId ? [s.sectionId] : [])} fileHref={fileHref} downloadHref={(f) => `${fileHref(f)}?download=1`} />}
      {tab === "notices" && <NoticesView notices={await noticesForStudent(ctx, s)} fileHref={fileHref} />}
      {tab === "coursework" && <CourseworkView items={await courseworkForStudent(ctx, s)} fileHref={fileHref} />}
      {tab === "fees" && can("fees.view") && <FeesView ledger={await studentLedger(ctx, id)} receiptHref={(pid) => `/c/${slug}/receipt/${pid}`} showDue />}
      {tab === "library" && <LibraryView loans={(await loansForStudent(ctx, id)).map((l) => ({ ...l, renewal: renewalEligibility(l.loan) }))} />}
      {tab === "transport" && <TransportView transport={await transportForStudent(ctx, id)} />}

      {tab === "card" && can("cards.manage") && <CardTab slug={slug} ctx={ctx} studentId={id} />}

      {tab === "documents" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card title="Authorized documents" className="lg:col-span-2" padded={false}>
            <DocList ctx={ctx} studentId={id} />
          </Card>
          {can("students.edit") && (
            <Card title="Upload document">
              <form action={uploadDocumentAction} encType="multipart/form-data" className="space-y-3">
                <TenantFields slug={slug} back={back} />
                <input type="hidden" name="id" value={id} />
                <Field label="Label">
                  <Input name="label" placeholder="e.g. Bonafide certificate" required maxLength={120} />
                </Field>
                <Field label="File" hint="PDF, JPEG, PNG, DOCX · max 4 MB">
                  <Input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.docx" />
                </Field>
                <SubmitButton>Upload</SubmitButton>
              </form>
            </Card>
          )}
        </div>
      )}

      {tab === "history" && can("audit.view") && <HistoryTab ctx={ctx} studentId={id} />}
    </>
  );
}

async function DocList({ ctx, studentId }: { ctx: Awaited<ReturnType<typeof requireTenant>>; studentId: string }) {
  const docs = await studentDocuments(ctx, studentId);
  if (!docs.length)
    return (
      <div className="p-5">
        <EmptyState title="No documents uploaded" />
      </div>
    );
  return (
    <ul className="divide-y divide-line">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center justify-between px-5 py-3 text-sm">
          <span>
            <span className="font-medium">{d.label}</span> <span className="text-muted">· {d.originalName} · {Math.ceil(d.sizeBytes / 1024)} KB</span>
          </span>
          <a href={`/api/files/${d.id}`} className="text-brand hover:underline">
            Download
          </a>
        </li>
      ))}
    </ul>
  );
}

async function CardTab({ slug, ctx, studentId }: { slug: string; ctx: Awaited<ReturnType<typeof requireTenant>>; studentId: string }) {
  const cards = await cardsForStudent(ctx, studentId);
  return (
    <Card title="NFC cards" padded={false} actions={<LinkButton href={`/c/${slug}/admin/cards?assign=${studentId}`}>Assign a card</LinkButton>}>
      {cards.length === 0 ? (
        <div className="p-5">
          <EmptyState title="No card assigned" />
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Serial</Th>
              <Th>Status</Th>
              <Th>Assigned</Th>
              <Th>Valid until</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id}>
                <Td className="font-mono text-xs">{c.serial}</Td>
                <Td>
                  <StatusBadge status={c.status} />
                </Td>
                <Td>{formatDate(c.assignedAt)}</Td>
                <Td>{formatDate(c.validUntil)}</Td>
                <Td>
                  <Link href={`/c/${slug}/admin/cards/${c.id}`} className="text-brand hover:underline">
                    Manage
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

async function HistoryTab({ ctx, studentId }: { ctx: Awaited<ReturnType<typeof requireTenant>>; studentId: string }) {
  const rows = await studentHistory(ctx, studentId);
  if (!rows.length) return <Alert>No recorded changes yet.</Alert>;
  return (
    <Card padded={false}>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="px-5 py-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="font-medium">{r.summary}</span>
              <span className="shrink-0 text-xs text-muted">{formatDateTime(r.createdAt)}</span>
            </div>
            <div className="text-xs text-muted">
              {r.action} · by {r.actorName ?? "system"}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
