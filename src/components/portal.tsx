import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, BookOpen, Bus, CalendarClock, ChevronLeft, ClipboardCheck, CreditCard, FileText, Home, Library, Megaphone, NotebookPen, Wallet, type LucideIcon } from "lucide-react";
import { MODULES, feature, type ModuleKey } from "@/lib/portal-config";
import { formatDate, formatMoney, initials } from "@/lib/format";
import { loadModule, portalHome, visibleModules, portalStudent, type PortalViewer } from "@/server/services/portal";
import { noticeForViewer } from "@/server/services/notices";
import { AttendanceView, CourseworkView, DigitalIdCard, FeesView, InternalMarksView, LibraryView, NoticeCard, NoticeDetail, NoticesView, ResultsView, TimetableView, TransportView } from "./views";
import { Badge, EmptyState, Input, LinkButton, Meter, cn } from "./ui";
import { SubmitButton } from "./client";
import { MarkNoticeRead, NotificationBell } from "./notifications";

export const MODULE_ICONS: Record<ModuleKey, LucideIcon> = {
  digital_id: CreditCard,
  attendance: ClipboardCheck,
  results: FileText,
  internal_marks: NotebookPen,
  timetable: CalendarClock,
  notices: Megaphone,
  coursework: BookOpen,
  fees: Wallet,
  library: Library,
  transport: Bus,
};

const SLUG_OF: Record<ModuleKey, string> = {
  digital_id: "id",
  attendance: "attendance",
  results: "results",
  internal_marks: "marks",
  timetable: "timetable",
  notices: "notices",
  coursework: "assignments",
  fees: "fees",
  library: "library",
  transport: "transport",
};
export const moduleFromSlug = (s: string) => (Object.entries(SLUG_OF).find(([, v]) => v === s)?.[0] as ModuleKey | undefined) ?? null;
export const moduleHref = (base: string, k: ModuleKey) => `${base}/${SLUG_OF[k]}`;
const label = (k: ModuleKey) => MODULES.find((m) => m.key === k)!.label;
const fileHref = (id: string) => `/api/files/${id}`;

export async function PortalShell({ v, base, active, children, topRight }: { v: PortalViewer; base: string; active: ModuleKey | "home"; children: ReactNode; topRight?: ReactNode }) {
  const me = await portalStudent(v);
  const mods = visibleModules(v, me.student);
  const b = v.config.branding;
  const s = me.student;
  const bottom = mods.filter((k) => k !== "digital_id").slice(0, 4);
  const showBell = !v.preview && mods.includes("notices");
  return (
    <div style={{ ["--brand" as string]: b.primaryColor, ["--accent" as string]: b.accentColor }} className="min-h-screen bg-bg pb-24 md:pb-10">
      {v.preview && <div className="sticky top-0 z-40 bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-amber-950">Preview — this is exactly what {s.fullName} sees with the configuration being previewed.</div>}
      <header className="relative overflow-hidden text-white" style={{ background: `linear-gradient(135deg, ${b.primaryColor}, color-mix(in srgb, ${b.primaryColor} 60%, black))` }}>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="relative mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          {b.logoFileId ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileHref(b.logoFileId)} alt="" className="h-10 w-10 rounded-lg bg-white object-contain p-0.5 shadow-sm" />
          ) : (
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-white/15 text-xs font-bold">{v.ctx.institution.shortName.slice(0, 3)}</span>
          )}
          <Link href={base} className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold sm:text-base">{v.ctx.institution.name}</div>
            <div className="text-xs text-white/70">Student portal</div>
          </Link>
          {showBell && <NotificationBell slug={v.ctx.institution.slug} noticeHref={moduleHref(base, "notices")} />}
          {topRight}
        </div>
        {active === "home" && (
          <div className="relative mx-auto flex max-w-6xl items-center gap-4 px-4 pb-6 pt-2">
            {s.photoFileId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileHref(s.photoFileId)} alt={`Photograph of ${s.fullName}`} className="h-20 w-20 shrink-0 rounded-2xl border-2 border-white/60 object-cover shadow-lg sm:h-24 sm:w-24" />
            ) : (
              <div className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border-2 border-white/40 bg-white/15 text-2xl font-semibold sm:h-24 sm:w-24" aria-hidden>
                {initials(s.fullName)}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold sm:text-2xl">{s.fullName}</h1>
              <p className="font-mono text-sm text-white/85">{s.enrollmentNo}</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                {me.department && <span className="rounded-full bg-white/15 px-2.5 py-1">{me.department.name}</span>}
                {me.programme && <span className="rounded-full bg-white/15 px-2.5 py-1">{me.programme.name}</span>}
                <span className="rounded-full bg-white/15 px-2.5 py-1">
                  Semester {s.semester}
                  {me.section ? ` · Section ${me.section.name}` : ""}
                </span>
              </div>
            </div>
          </div>
        )}
        <nav className="relative mx-auto hidden max-w-6xl gap-1 overflow-x-auto px-3 pb-2 md:flex" aria-label="Portal sections">
          <NavLink href={base} on={active === "home"}>
            Home
          </NavLink>
          {mods.map((k) => (
            <NavLink key={k} href={moduleHref(base, k)} on={active === k}>
              {label(k)}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t border-line bg-surface/95 backdrop-blur md:hidden" style={{ gridTemplateColumns: `repeat(${bottom.length + 1}, minmax(0, 1fr))` }} aria-label="Quick navigation">
        <BottomLink href={base} on={active === "home"} icon={Home}>
          Home
        </BottomLink>
        {bottom.map((k) => (
          <BottomLink key={k} href={moduleHref(base, k)} on={active === k} icon={MODULE_ICONS[k]}>
            {label(k).split(/[ &]/)[0]}
          </BottomLink>
        ))}
      </nav>
    </div>
  );
}

function NavLink({ href, on, children }: { href: string; on: boolean; children: ReactNode }) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined} className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/10 hover:text-white", on && "bg-white/20 text-white")}>
      {children}
    </Link>
  );
}

function BottomLink({ href, on, icon: Icon, children }: { href: string; on: boolean; icon: LucideIcon; children: ReactNode }) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined} className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium", on ? "text-brand" : "text-muted")}>
      <Icon className="h-5 w-5" aria-hidden />
      {children}
    </Link>
  );
}

export async function PortalHome({ v, base }: { v: PortalViewer; base: string }) {
  const h = await portalHome(v);
  const s = h.me.student;
  const has = (k: ModuleKey) => h.modules.includes(k);
  const summary: Partial<Record<ModuleKey, string>> = {
    results: "Published semester results and grades",
    internal_marks: "Practical, lab, viva and internal marks",
    timetable: h.timetable ? `${h.timetable.title} · updated ${formatDate(h.timetable.updatedAt)}` : "No timetable published yet",
    notices: h.unreadNotices ? `${h.unreadNotices} unread notice${h.unreadNotices === 1 ? "" : "s"}` : "You're all caught up",
    coursework: h.assignments ? `${h.assignments} item${h.assignments === 1 ? "" : "s"}${h.latestAssignment ? ` · latest: ${h.latestAssignment.subject}` : ""}` : "Nothing posted yet",
    library: "Books issued to you and fines",
    attendance: "Attendance summary and history",
    fees: "Fee status and receipts",
    transport: "Your bus route and stop",
  };
  return (
    <div className="space-y-8">
      {v.config.branding.welcomeMessage && <p className="text-sm text-muted">{v.config.branding.welcomeMessage}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_1fr]">
        {has("digital_id") && (
          <section aria-labelledby="id-h">
            <h2 id="id-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              Digital student ID
            </h2>
            <DigitalIdCard college={{ name: v.ctx.institution.name, logoUrl: v.config.branding.logoFileId ? fileHref(v.config.branding.logoFileId) : null }} student={{ ...s, department: h.me.department?.name, programme: h.me.programme?.name }} photoUrl={s.photoFileId ? fileHref(s.photoFileId) : null} brand={v.config.branding.primaryColor} />
          </section>
        )}
        <section aria-labelledby="sections-h" className="min-w-0">
          <h2 id="sections-h" className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Your sections
          </h2>
          {/* Optional tiles: data only exists here when the super admin enabled it. */}
          {(h.attendance || h.cgpa !== null || h.balance !== null || h.dueAssignments !== null) && (
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {h.attendance && (
                <Tile href={moduleHref(base, "attendance")} label="Attendance">
                  <div className={cn("text-2xl font-semibold tabular-nums", h.attendance.shortage ? "text-danger" : "text-ok")}>{h.attendance.percentage ?? "—"}%</div>
                  <Meter value={h.attendance.percentage} threshold={h.threshold ?? undefined} />
                </Tile>
              )}
              {h.cgpa !== null && (
                <Tile href={moduleHref(base, "results")} label="CGPA">
                  <div className="text-2xl font-semibold tabular-nums">{h.cgpa}</div>
                </Tile>
              )}
              {h.balance !== null && (
                <Tile href={moduleHref(base, "fees")} label="Fee balance">
                  <div className={cn("text-xl font-semibold tabular-nums", h.balance > 0 ? "text-danger" : "text-ok")}>{formatMoney(Math.max(0, h.balance))}</div>
                </Tile>
              )}
              {h.dueAssignments !== null && (
                <Tile href={moduleHref(base, "coursework")} label="Assignments due">
                  <div className="text-2xl font-semibold tabular-nums">{h.dueAssignments}</div>
                </Tile>
              )}
            </div>
          )}
          <ul className="grid gap-3 sm:grid-cols-2">
            {h.modules
              .filter((k) => k !== "digital_id")
              .map((k) => {
                const Icon = MODULE_ICONS[k];
                const unread = k === "notices" && (h.unreadNotices ?? 0) > 0;
                return (
                  <li key={k}>
                    <Link href={moduleHref(base, k)} className="group flex h-full items-center gap-3 rounded-2xl border border-line bg-surface p-4 transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md">
                      <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                        <Icon className="h-5 w-5" aria-hidden />
                        {unread && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-red-500 ring-2 ring-surface" aria-hidden />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{label(k)}</span>
                        <span className="block truncate text-xs text-muted">{summary[k]}</span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand" aria-hidden />
                    </Link>
                  </li>
                );
              })}
          </ul>
        </section>
      </div>

      {h.notices && (
        <section aria-labelledby="notices-h">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="notices-h" className="text-sm font-semibold uppercase tracking-wide text-muted">
              Latest notices
            </h2>
            <Link href={moduleHref(base, "notices")} className="text-sm font-medium text-brand">
              View all
            </Link>
          </div>
          {h.notices.length === 0 ? (
            <EmptyState title="No notices yet" />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {h.notices.map((n) => (
                <li key={n.id}>
                  <NoticeCard n={n} href={`${moduleHref(base, "notices")}/${n.id}`} fileHref={fileHref} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Tile({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <Link href={href} className="block rounded-2xl border border-line bg-surface p-4 transition hover:border-brand/40">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      {children}
    </Link>
  );
}

export async function PortalModule({ v, k, q, page, base, submitAction }: { v: PortalViewer; k: ModuleKey; q?: string; page?: number; base: string; submitAction?: (fd: FormData) => Promise<void> }) {
  const data = await loadModule(v, k, { q, page });
  const slug = v.ctx.institution.slug;
  let body: ReactNode = null;
  switch (data.key) {
    case "digital_id": {
      const s = data.me.student;
      const live = data.cards.find((c) => c.status === "active" || c.status === "inactive");
      body = (
        <DigitalIdCard
          college={{ name: v.ctx.institution.name, logoUrl: v.config.branding.logoFileId ? fileHref(v.config.branding.logoFileId) : null }}
          student={{ ...s, department: data.me.department?.name, programme: data.me.programme?.name }}
          photoUrl={s.photoFileId ? fileHref(s.photoFileId) : null}
          card={live ? { status: live.status, validUntil: live.validUntil } : null}
          brand={v.config.branding.primaryColor}
        />
      );
      break;
    }
    case "attendance":
      body = <AttendanceView data={data.data} />;
      break;
    case "results":
      body = <ResultsView data={data.data} showCgpa={feature(v.config, "showCGPA")} />;
      break;
    case "internal_marks":
      body = <InternalMarksView data={data.data} />;
      break;
    case "timetable":
      body = <TimetableView images={data.images} events={data.events} exams={data.exams} fileHref={fileHref} downloadHref={(id) => `${fileHref(id)}?download=1`} />;
      break;
    case "notices": {
      const f = data.feed;
      const href = moduleHref(base, "notices");
      const pageHref = (p: number) => `${href}?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;
      body = (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <form role="search" className="flex-1">
              <Input name="q" defaultValue={q} placeholder="Search notices" aria-label="Search notices" />
            </form>
            <span className="text-sm text-muted">{f.unread ? <Badge tone="blue">{f.unread} unread</Badge> : "All caught up"}</span>
          </div>
          {f.items.length === 0 ? (
            <EmptyState title={q ? "No notices match your search" : "No notices yet"} description="Announcements from your college appear here, newest first." />
          ) : (
            <NoticesView notices={f.items} fileHref={fileHref} hrefFor={(id) => `${href}/${id}`} />
          )}
          {f.pages > 1 && (
            <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
              <span className="text-muted">
                Page {f.page} of {f.pages}
              </span>
              <div className="flex gap-2">
                {f.page > 1 && <LinkButton href={pageHref(f.page - 1)}>Newer</LinkButton>}
                {f.page < f.pages && <LinkButton href={pageHref(f.page + 1)}>Older</LinkButton>}
              </div>
            </nav>
          )}
        </div>
      );
      break;
    }
    case "coursework":
      body = (
        <CourseworkView
          items={data.items}
          fileHref={fileHref}
          submitSlot={(i) =>
            submitAction && !v.preview && i.item.acceptSubmissions && i.submission?.grade == null && (!i.item.dueAt || i.item.dueAt > new Date()) ? (
              <form action={submitAction} encType="multipart/form-data" className="mt-3 flex flex-col gap-2 rounded-lg border border-dashed border-line p-3 sm:flex-row sm:items-center">
                <input type="hidden" name="_slug" value={slug} />
                <input type="hidden" name="_back" value={`/c/${slug}/portal/assignments`} />
                <input type="hidden" name="courseworkId" value={i.item.id} />
                <input type="file" name="file" required accept=".pdf,.docx,.jpg,.jpeg,.png" className="text-xs" aria-label="Submission file" />
                <input type="text" name="note" placeholder="Note (optional)" maxLength={1000} className="flex-1 rounded-lg border border-line px-2 py-1.5 text-xs" aria-label="Note" />
                <SubmitButton className="py-1.5 text-xs">{i.submission ? "Resubmit" : "Submit"}</SubmitButton>
              </form>
            ) : null
          }
        />
      );
      break;
    case "fees":
      body = <FeesView ledger={data.ledger} receiptHref={(id) => `/c/${slug}/receipt/${id}`} showDue={feature(v.config, "showFeeDueReminders")} />;
      break;
    case "library":
      body = (
        <div className="space-y-5">
          <LibraryView loans={data.loans} />
          {data.notices.length > 0 && <NoticesView notices={data.notices} fileHref={fileHref} />}
        </div>
      );
      break;
    case "transport":
      body = (
        <div className="space-y-5">
          <TransportView transport={data.transport} />
          {data.notices.length > 0 && <NoticesView notices={data.notices} fileHref={fileHref} />}
        </div>
      );
      break;
  }
  const Icon = MODULE_ICONS[k];
  return (
    <div className="fade-in">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-brand">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold sm:text-2xl">{label(k)}</h1>
      </div>
      {body}
    </div>
  );
}

/** One notice, opened from the feed or the bell. Opening it marks only this notice as read. */
export async function PortalNotice({ v, base, id }: { v: PortalViewer; base: string; id: string }) {
  const me = await portalStudent(v);
  const n = await noticeForViewer(v.ctx, { kind: "student", student: me.student }, id);
  return (
    <div className="fade-in mx-auto max-w-3xl">
      <Link href={moduleHref(base, "notices")} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden /> All notices
      </Link>
      <NoticeDetail n={n} fileHref={fileHref} />
      {!v.preview && <MarkNoticeRead slug={v.ctx.institution.slug} id={n.id} unread={n.unread} />}
    </div>
  );
}