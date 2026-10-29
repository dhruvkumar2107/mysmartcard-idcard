import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpen, Bus, CalendarClock, ClipboardCheck, CreditCard, FileText, Home, Library, Megaphone, NotebookPen, Wallet, type LucideIcon } from "lucide-react";
import { MODULES, type ModuleKey } from "@/lib/portal-config";
import { formatDate, formatMoney } from "@/lib/format";
import { loadModule, portalHome, visibleModules, portalStudent, type PortalViewer } from "@/server/services/portal";
import { AttendanceView, CourseworkView, DigitalIdCard, FeesView, InternalMarksView, LibraryView, NoticesView, ResultsView, TimetableView, TransportView } from "./views";
import { Badge, Card, Input, Meter, cn } from "./ui";
import { SubmitButton } from "./client";

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

export async function PortalShell({ v, base, active, children, topRight }: { v: PortalViewer; base: string; active: ModuleKey | "home"; children: ReactNode; topRight?: ReactNode }) {
  const me = await portalStudent(v);
  const mods = visibleModules(v, me.student);
  const b = v.config.branding;
  const bottom = (["attendance", "results", "timetable", "notices"] as ModuleKey[]).filter((k) => mods.includes(k)).slice(0, 4);
  return (
    <div style={{ ["--brand" as string]: b.primaryColor, ["--accent" as string]: b.accentColor }} className="min-h-screen pb-20 md:pb-0">
      {v.preview && <div className="sticky top-0 z-40 bg-amber-400 px-4 py-1.5 text-center text-xs font-medium text-amber-950">Preview of the DRAFT portal configuration as {me.student.fullName} sees it — not visible to students until published.</div>}
      <header className="text-white" style={{ background: `linear-gradient(135deg, ${b.primaryColor}, color-mix(in srgb, ${b.primaryColor} 65%, black))` }}>
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
          {b.logoFileId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/files/${b.logoFileId}`} alt="" className="h-9 w-9 rounded-md bg-white object-contain p-0.5" />
          )}
          <Link href={base} className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{v.ctx.institution.name}</div>
            <div className="text-xs text-white/70">Student portal</div>
          </Link>
          {topRight}
        </div>
        <nav className="mx-auto hidden max-w-5xl gap-1 overflow-x-auto px-3 pb-2 md:flex" aria-label="Portal">
          <Link href={base} className={cn("rounded-lg px-3 py-1.5 text-sm text-white/80 hover:bg-white/10", active === "home" && "bg-white/15 text-white")}>
            Home
          </Link>
          {mods.map((k) => (
            <Link key={k} href={moduleHref(base, k)} className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-white/80 hover:bg-white/10", active === k && "bg-white/15 text-white")}>
              {MODULES.find((m) => m.key === k)!.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-5">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface md:hidden" aria-label="Quick">
        <Link href={base} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", active === "home" ? "text-brand" : "text-muted")}>
          <Home className="h-5 w-5" aria-hidden /> Home
        </Link>
        {bottom.map((k) => {
          const Icon = MODULE_ICONS[k];
          return (
            <Link key={k} href={moduleHref(base, k)} className={cn("flex flex-col items-center gap-0.5 py-2 text-[11px]", active === k ? "text-brand" : "text-muted")}>
              <Icon className="h-5 w-5" aria-hidden /> {MODULES.find((m) => m.key === k)!.label.split(" ")[0]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export async function PortalHome({ v, base }: { v: PortalViewer; base: string }) {
  const h = await portalHome(v);
  const s = h.me.student;
  const photo = s.photoFileId ? `/api/files/${s.photoFileId}` : null;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Hi, {s.fullName.split(" ")[0]}</h1>
        <p className="text-sm text-muted">{v.config.branding.welcomeMessage}</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        {h.modules.includes("digital_id") && (
          <DigitalIdCard college={{ name: v.ctx.institution.name, logoUrl: v.config.branding.logoFileId ? `/api/files/${v.config.branding.logoFileId}` : null }} student={{ ...s, department: h.me.department?.name, programme: h.me.programme?.name }} photoUrl={photo} brand={v.config.branding.primaryColor} />
        )}
        <div className="grid grid-cols-2 gap-3 self-start">
          {h.attendance && (
            <Tile href={moduleHref(base, "attendance")} label="Attendance">
              <div className={cn("text-2xl font-semibold tabular-nums", h.attendance.shortage ? "text-danger" : "text-ok")}>{h.attendance.percentage ?? "—"}%</div>
              <Meter value={h.attendance.percentage} threshold={h.threshold ?? undefined} />
              {h.attendance.shortage && <div className="mt-1 text-xs text-danger">Below {h.threshold}%</div>}
            </Tile>
          )}
          {h.modules.includes("results") && (
            <Tile href={moduleHref(base, "results")} label="CGPA">
              <div className="text-2xl font-semibold tabular-nums">{h.cgpa ?? "—"}</div>
              <div className="text-xs text-muted">Published results</div>
            </Tile>
          )}
          {h.balance !== null && (
            <Tile href={moduleHref(base, "fees")} label="Fee balance">
              <div className={cn("text-xl font-semibold tabular-nums", h.balance > 0 ? "text-danger" : "text-ok")}>{formatMoney(Math.max(0, h.balance))}</div>
              <div className="text-xs text-muted">{h.balance > 0 ? "Outstanding" : "All clear"}</div>
            </Tile>
          )}
          {h.dueAssignments !== null && (
            <Tile href={moduleHref(base, "coursework")} label="Assignments due">
              <div className="text-2xl font-semibold tabular-nums">{h.dueAssignments}</div>
              <div className="text-xs text-muted">Not yet submitted</div>
            </Tile>
          )}
        </div>
      </div>
      {h.notices && h.notices.length > 0 && (
        <Card title="Latest notices" padded={false} actions={<Link href={moduleHref(base, "notices")} className="text-sm text-brand">All</Link>}>
          <ul className="divide-y divide-line">
            {h.notices.map((n) => (
              <li key={n.id} className="px-5 py-3 text-sm">
                <div className="flex items-center gap-2">
                  {n.pinned && <Badge tone="violet">Pinned</Badge>}
                  <span className="font-medium">{n.title}</span>
                </div>
                <div className="text-xs text-muted">{formatDate(n.publishAt)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {h.modules.map((k) => {
          const Icon = MODULE_ICONS[k];
          return (
            <Link key={k} href={moduleHref(base, k)} className="flex flex-col items-center gap-2 rounded-xl border border-line bg-surface p-3 text-center text-xs font-medium hover:border-brand/40">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand/10 text-brand">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              {MODULES.find((m) => m.key === k)!.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function Tile({ href, label, children }: { href: string; label: string; children: ReactNode }) {
  return (
    <Link href={href} className="block rounded-xl border border-line bg-surface p-4 hover:border-brand/40">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      {children}
    </Link>
  );
}

export async function PortalModule({ v, k, q, submitAction }: { v: PortalViewer; k: ModuleKey; q?: string; submitAction?: (fd: FormData) => Promise<void> }) {
  const data = await loadModule(v, k, { q });
  const fileHref = (id: string) => `/api/files/${id}`;
  const title = MODULES.find((m) => m.key === k)!.label;
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
      body = <ResultsView data={data.data} />;
      break;
    case "internal_marks":
      body = <InternalMarksView data={data.data} />;
      break;
    case "timetable":
      body = <TimetableView slots={data.slots} events={data.events} exams={data.exams} />;
      break;
    case "notices":
      body = (
        <div className="space-y-4">
          <form role="search">
            <Input name="q" defaultValue={q} placeholder="Search notices" aria-label="Search notices" />
          </form>
          <NoticesView notices={data.notices} fileHref={fileHref} />
        </div>
      );
      break;
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
      body = <FeesView ledger={data.ledger} receiptHref={(id) => `/c/${slug}/receipt/${id}`} />;
      break;
    case "library":
      body = (
        <div className="space-y-4">
          <LibraryView loans={data.loans} />
          {data.notices.length > 0 && <NoticesView notices={data.notices} fileHref={fileHref} />}
        </div>
      );
      break;
    case "transport":
      body = (
        <div className="space-y-4">
          <TransportView transport={data.transport} />
          {data.notices.length > 0 && <NoticesView notices={data.notices} fileHref={fileHref} />}
        </div>
      );
      break;
  }
  return (
    <div className="fade-in">
      <h1 className="mb-4 text-xl font-semibold">{title}</h1>
      {body}
    </div>
  );
}
