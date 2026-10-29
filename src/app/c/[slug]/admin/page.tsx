import Link from "next/link";
import { CalendarDays, CreditCard, FilePlus2, Megaphone, UserPlus } from "lucide-react";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { formatDate } from "@/lib/format";
import type { SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { dashboard } from "@/server/services/dashboard";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ params }: SlugProps) {
  const { slug } = await params;
  const ctx = await requireTenant(slug, "dashboard.view");
  const d = await dashboard(ctx);
  const base = `/c/${slug}/admin`;
  const maxDept = Math.max(1, ...d.byDept.map((x) => x.total));
  const can = (p: Parameters<typeof ctx.perms.has>[0]) => ctx.perms.has(p);

  return (
    <>
      <PageHeader
        title={`Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, ${ctx.user.name.split(" ")[0]}`}
        description={`${ctx.institution.name} · live overview`}
        actions={
          <>
            {can("students.edit") && (
              <LinkButton href={`${base}/students/new`} variant="primary">
                <UserPlus className="h-4 w-4" aria-hidden /> Add student
              </LinkButton>
            )}
            {can("notices.publish") && (
              <LinkButton href={`${base}/notices`}>
                <Megaphone className="h-4 w-4" aria-hidden /> Publish notice
              </LinkButton>
            )}
            {can("assessments.manage") && (
              <LinkButton href={`${base}/exams`}>
                <FilePlus2 className="h-4 w-4" aria-hidden /> Create exam
              </LinkButton>
            )}
            {can("cards.manage") && (
              <LinkButton href={`${base}/cards`}>
                <CreditCard className="h-4 w-4" aria-hidden /> Assign card
              </LinkButton>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Registered students" value={d.students.total} hint={`${d.students.active} active · ${d.students.inactive} inactive · ${d.students.graduated} graduated`} href={can("students.view") ? `${base}/students` : undefined} />
        <Stat label="Faculty members" value={d.faculty} hint="Active teaching staff" href={can("faculty.view") ? `${base}/faculty` : undefined} />
        <Stat
          label="Attendance (30 days)"
          value={d.attendance.percentage === null ? "—" : `${d.attendance.percentage}%`}
          tone={d.attendance.percentage !== null && d.attendance.percentage < ctx.academic.attendanceThreshold ? "warn" : "default"}
          hint={`${d.attendance.sessions} sessions · threshold ${ctx.academic.attendanceThreshold}%`}
        />
        <Stat label="NFC cards" value={d.cards.active} hint={`${d.cards.active} active · ${d.cards.inactive} inactive · ${d.cards.unassigned} unassigned · ${d.cards.revoked} retired`} href={can("cards.manage") ? `${base}/cards` : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Students by department" className="lg:col-span-2">
          {d.byDept.length === 0 ? (
            <EmptyState title="No departments yet" description="Create departments and programmes in Academic structure." />
          ) : (
            <ul className="space-y-3">
              {d.byDept.map((x) => (
                <li key={x.departmentId}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>
                      <span className="font-medium">{x.code}</span> <span className="text-muted">{x.name}</span>
                    </span>
                    <span className="tabular-nums">{x.total}</span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-2">
                    <div className="h-2 rounded-full bg-brand" style={{ width: `${(x.total / maxDept) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Needs attention">
          <ul className="space-y-3 text-sm">
            <li className="flex items-center justify-between">
              <Link href={`${base}/exams?status=pending`} className="hover:underline">
                Results awaiting approval / publication
              </Link>
              <Badge tone={d.pendingResults ? "amber" : "gray"}>{d.pendingResults}</Badge>
            </li>
            <li className="flex items-center justify-between">
              <Link href={`${base}/attendance#corrections`} className="hover:underline">
                Attendance corrections pending
              </Link>
              <Badge tone={d.pendingCorrections ? "amber" : "gray"}>{d.pendingCorrections}</Badge>
            </li>
            <li className="flex items-center justify-between">
              <Link href={`${base}/cards?status=unassigned`} className="hover:underline">
                Unassigned NFC cards in stock
              </Link>
              <Badge>{d.cards.unassigned}</Badge>
            </li>
          </ul>
        </Card>

        <Card title="Upcoming examinations" className="lg:col-span-2" padded={false}>
          {d.exams.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No upcoming examinations scheduled" />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {d.exams.map((e) => (
                <li key={e.assessment.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div>
                    <div className="font-medium">
                      {e.subjectCode} · {e.assessment.name}
                    </div>
                    <div className="text-muted">
                      {e.programmeCode} Sem {e.semester}-{e.sectionName} · {e.assessment.room ?? "Room TBA"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="tabular-nums">{formatDate(e.assessment.examDate)}</div>
                    <StatusBadge status={e.assessment.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Academic calendar" padded={false}>
          {d.events.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No upcoming deadlines or holidays" />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {d.events.map((e) => (
                <li key={e.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                  <CalendarDays className="mt-0.5 h-4 w-4 text-muted" aria-hidden />
                  <div>
                    <div className="font-medium">{e.title}</div>
                    <div className="text-muted">
                      {formatDate(e.startDate)} · {e.kind.replace("_", " ")}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent notices" className="lg:col-span-3" padded={false} actions={can("notices.publish") ? <LinkButton href={`${base}/notices`}>Manage</LinkButton> : undefined}>
          {d.notices.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No live notices" />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {d.notices.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="truncate">
                    {n.pinned && <Badge tone="violet">Pinned</Badge>} <span className="font-medium">{n.title}</span>
                  </span>
                  <span className="shrink-0 text-muted">{formatDate(n.publishAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
