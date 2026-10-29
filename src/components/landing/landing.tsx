import Link from "next/link";
import {
  ArrowRight,
  Award,
  BookOpen,
  Building2,
  Bus,
  CalendarCheck,
  CalendarDays,
  Check,
  ClipboardList,
  FileSpreadsheet,
  GraduationCap,
  IdCard,
  KeyRound,
  LayoutDashboard,
  Library,
  LockKeyhole,
  Megaphone,
  Nfc,
  Palette,
  ScrollText,
  ShieldCheck,
  Smartphone,
  Users,
  Wallet,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { IdCard3D } from "./id-card-3d";
import { Reveal } from "./reveal";

const MODULES = [
  { icon: IdCard, title: "Digital ID", body: "Photo, enrollment, programme and live card status." },
  { icon: CalendarCheck, title: "Attendance", body: "Overall and subject-wise, with shortage alerts." },
  { icon: Award, title: "Results", body: "Internal, midterm and end-semester, published by the college." },
  { icon: ClipboardList, title: "Internal marks", body: "Labs, viva, class tests and projects." },
  { icon: CalendarDays, title: "Timetable", body: "Weekly schedule, holidays and exam dates." },
  { icon: Megaphone, title: "Notice board", body: "Circulars targeted by department or programme." },
  { icon: BookOpen, title: "Coursework", body: "Assignments, notes and submissions." },
  { icon: Wallet, title: "Fees & receipts", body: "Dues, payments and printable receipts." },
  { icon: Library, title: "Library", body: "Issued books, due dates and fines." },
  { icon: Bus, title: "Transport", body: "Route, pickup point and timings." },
];

const ADMIN = [
  { icon: LayoutDashboard, title: "Live college dashboard", body: "Students, attendance, fee collection and card activity at a glance." },
  { icon: FileSpreadsheet, title: "Bulk student import", body: "Upload a CSV or Excel sheet and the whole batch is onboarded in minutes." },
  { icon: Nfc, title: "Full card lifecycle", body: "Issue, rotate, revoke and replace NFC cards. Old links die instantly." },
  { icon: Palette, title: "Portal designer", body: "Your colours, your logo, your modules. Preview before you publish." },
  { icon: Users, title: "8 roles, fine permissions", body: "Admin, principal, HOD, faculty, accounts, librarian, transport and students." },
  { icon: ScrollText, title: "Complete audit trail", body: "Every change is recorded with who did it and when." },
];

const STEPS = [
  { icon: ShieldCheck, who: "Super admin", title: "Register the college", body: "Create the college workspace and hand its admin their login." },
  { icon: Building2, who: "College admin", title: "Add students & issue cards", body: "Import records, set up academics and link an NFC card to each student." },
  { icon: Nfc, who: "Student", title: "Tap the card", body: "Any NFC phone opens the verified digital ID. No app needed." },
  { icon: Smartphone, who: "Portal", title: "Everything in one place", body: "After sign-in: attendance, results, fees, timetable and more." },
];

export function Landing() {
  return (
    <main className="relative isolate min-h-screen overflow-x-clip bg-white text-slate-900">
      {/* ambient glows */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[900px] overflow-hidden">
        <div className="glow-drift absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-indigo-300/40 blur-[120px]" />
        <div className="glow-drift absolute -right-32 top-40 h-[480px] w-[480px] rounded-full bg-sky-300/40 blur-[120px] [animation-delay:-6s]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,.07)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,.07)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_70%)]" />
      </div>

      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" aria-label="MySmartCard Campus home">
            <BrandMark />
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-slate-600 md:flex">
            <a href="#how" className="hover:text-slate-900">How it works</a>
            <a href="#features" className="hover:text-slate-900">Features</a>
            <a href="#roles" className="hover:text-slate-900">For colleges</a>
            <a href="#security" className="hover:text-slate-900">Security</a>
          </nav>
          <Link href="/login" className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700">
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-14 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
        <div className="rise text-center lg:text-left">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" /> NFC student ID + complete campus management
          </span>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            One tap.
            <br />
            <span className="bg-[linear-gradient(90deg,#0284c7,#4f46e5,#c026d3)] bg-clip-text text-transparent">The whole campus.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-slate-600 lg:mx-0">
            Every college gets its own admin panel for students, academics, fees and more. Every student gets a smart ID card that opens their verified profile with a single tap.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
            <Link href="/login" className="group inline-flex items-center justify-center gap-2 rounded-full bg-[linear-gradient(90deg,#0ea5e9,#6366f1)] px-6 py-3 font-semibold text-white shadow-[0_10px_40px_-10px_rgba(99,102,241,.8)] transition hover:brightness-110">
              Sign in to your college <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <a href="#how" className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50">
              See how it works
            </a>
          </div>
          <ul className="mx-auto mt-9 flex max-w-md flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-slate-600 lg:mx-0 lg:justify-start">
            {["No app to install", "Works on any NFC phone", "Each college fully separate"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="h-4 w-4 text-emerald-600" aria-hidden /> {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <IdCard3D />
          <div aria-hidden className="float-chip absolute -left-12 bottom-24 hidden rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm shadow-xl shadow-indigo-500/10 backdrop-blur-md sm:block">
            <div className="text-xs text-slate-500">Attendance</div>
            <div className="text-xl font-semibold text-emerald-600">92%</div>
          </div>
          <div aria-hidden className="float-chip absolute -right-4 -top-20 hidden rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm shadow-xl shadow-indigo-500/10 backdrop-blur-md [animation-delay:-3s] sm:block">
            <div className="flex items-center gap-2 font-medium text-emerald-600">
              <ShieldCheck className="h-4 w-4" /> Verified student
            </div>
            <div className="text-xs text-slate-500">Portal opened in 0.4s</div>
          </div>
        </div>
      </section>

      {/* Numbers */}
      <section className="border-y border-slate-200 bg-slate-50/80">
        <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 py-10 text-center md:grid-cols-4">
          {[
            ["10", "student portal modules"],
            ["8", "staff & student roles"],
            ["1 tap", "from card to profile"],
            ["100%", "data isolation per college"],
          ].map(([v, l]) => (
            <div key={l}>
              <dt className="sr-only">{l}</dt>
              <dd className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{v}</dd>
              <dd className="mt-1 text-sm text-slate-600">{l}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* How it works, with the animated connector */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">How it works</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">From onboarding to a tap, connected end to end</h2>
        </Reveal>
        <div className="relative mt-16">
          {/* connector: horizontal on desktop, vertical on mobile */}
          <div aria-hidden className="connector absolute left-[12.5%] right-[12.5%] top-8 hidden h-0.5 lg:block">
            <span className="connector-dot absolute -top-[5px] h-3 w-3 rounded-full bg-indigo-500 shadow-[0_0_14px_4px_rgba(99,102,241,.45)]" />
          </div>
          <div aria-hidden className="connector-v absolute bottom-8 left-8 top-8 w-0.5 lg:hidden">
            <span className="connector-dot-v absolute -left-[5px] h-3 w-3 rounded-full bg-indigo-500 shadow-[0_0_14px_4px_rgba(99,102,241,.45)]" />
          </div>
          <ol className="relative grid gap-10 lg:grid-cols-4 lg:gap-6">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <Reveal delay={i * 120} className="flex gap-5 lg:flex-col lg:items-center lg:text-center">
                  <span className="relative grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-slate-200 bg-white shadow-[0_0_0_6px_#fff,0_10px_30px_-10px_rgba(79,70,229,.35)]">
                    <s.icon className="h-7 w-7 text-indigo-600" aria-hidden />
                    <span className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">{i + 1}</span>
                  </span>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wider text-indigo-600">{s.who}</div>
                    <h3 className="mt-1 text-lg font-semibold">{s.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{s.body}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Student modules */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Student portal</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Ten modules behind every card</h2>
          <p className="mt-4 text-slate-600">Colleges switch each module on or off, and can limit it to certain departments or programmes.</p>
        </Reveal>
        <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          {MODULES.map((m, i) => (
            <Reveal key={m.title} delay={(i % 5) * 70}>
              <div className="group h-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-500/10 sm:p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[linear-gradient(135deg,#e0f2fe,#e0e7ff)] ring-1 ring-indigo-100">
                  <m.icon className="h-5 w-5 text-indigo-600" aria-hidden />
                </span>
                <h3 className="mt-4 font-semibold">{m.title}</h3>
                <p className="mt-1 text-sm text-slate-600">{m.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Admin capabilities */}
      <section className="relative border-y border-slate-200 bg-[linear-gradient(180deg,#eef2ff,#f8fafc)]">
        <div className="mx-auto max-w-6xl px-4 py-24">
          <Reveal className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">College admin panel</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Your whole college, in one dashboard</h2>
            <p className="mt-4 text-slate-600">Students, faculty, academics, attendance, exams, fees, library and transport, all managed by your own team.</p>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {ADMIN.map((a, i) => (
              <Reveal key={a.title} delay={(i % 3) * 90}>
                <div className="flex h-full gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <a.icon className="h-6 w-6 shrink-0 text-indigo-600" aria-hidden />
                  <div>
                    <h3 className="font-semibold">{a.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{a.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Roles */}
      <section id="roles" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-600">Built for every role</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Three panels, one connected system</h2>
        </Reveal>
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {[
            { icon: KeyRound, title: "Super admin", tone: "from-fuchsia-100", points: ["Register any college", "Issue & reset admin logins", "Control plans and modules", "Suspend or reactivate"] },
            { icon: Building2, title: "College admin", tone: "from-indigo-100", points: ["Every student record", "Staff accounts & permissions", "Fees, library, transport", "Design the student portal"] },
            { icon: GraduationCap, title: "Student", tone: "from-sky-100", points: ["Tap card for digital ID", "Attendance and results", "Fees and receipts", "Notices and timetable"] },
          ].map((r, i) => (
            <Reveal key={r.title} delay={i * 120}>
              <div className={`relative h-full overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-b ${r.tone} to-white p-7 shadow-sm`}>
                <r.icon className="h-8 w-8 text-indigo-600" aria-hidden />
                <h3 className="mt-5 text-xl font-semibold">{r.title}</h3>
                <ul className="mt-4 space-y-2.5 text-sm text-slate-700">
                  {r.points.map((p) => (
                    <li key={p} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-emerald-600" aria-hidden /> {p}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Security */}
      <section id="security" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24">
        <Reveal>
          <div className="grid items-center gap-10 rounded-3xl border border-emerald-100 bg-emerald-50/50 p-8 sm:p-12 lg:grid-cols-[auto_1fr]">
            <span className="grid h-20 w-20 place-items-center rounded-3xl bg-white ring-1 ring-emerald-200">
              <LockKeyhole className="h-9 w-9 text-emerald-600" aria-hidden />
            </span>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Private by design</h2>
              <ul className="mt-5 grid gap-3 text-sm text-slate-700 sm:grid-cols-2">
                {[
                  "Tapping a card shows only what the college approves",
                  "Marks, fees and attendance always need sign-in",
                  "Card links can be revoked or rotated instantly",
                  "Each college's data is strictly separated",
                ].map((t) => (
                  <li key={t} className="flex gap-2">
                    <ShieldCheck className="h-4 w-4 shrink-0 translate-y-0.5 text-emerald-600" aria-hidden /> {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl bg-[linear-gradient(120deg,#0ea5e9,#6366f1_55%,#a855f7)] px-8 py-14 text-center sm:px-16">
            <div aria-hidden className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/20 blur-3xl" />
            <h2 className="relative text-3xl font-semibold tracking-tight text-white sm:text-4xl">Bring smart ID cards to your campus</h2>
            <p className="relative mx-auto mt-3 max-w-xl text-white/85">Already onboarded? Sign in with the credentials from your administrator.</p>
            <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 font-semibold text-slate-900 transition hover:bg-slate-100">
                Sign in <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <a href="https://www.mysmartcard.net/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center rounded-full border border-white/40 px-6 py-3 font-semibold text-white transition hover:bg-white/10">
                Contact MySmartCard
              </a>
            </div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-slate-500 sm:flex-row">
          <BrandMark />
          <p>© {new Date().getFullYear()} MySmartCard Campus</p>
        </div>
      </footer>
    </main>
  );
}
