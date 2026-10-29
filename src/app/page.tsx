import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Building2, GraduationCap, ShieldCheck, Nfc } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Badge, Card, LinkButton } from "@/components/ui";
import { ROLE_LABELS, isRole } from "@/lib/permissions";
import { getSessionUser } from "@/server/session";
import { myWorkspaces } from "@/server/services/platform";
import { logout } from "@/server/actions/auth";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) return <Landing />;
  const spaces = await myWorkspaces(user.id);
  const live = spaces.filter((s) => s.membershipStatus === "active");
  if (!user.isSuperAdmin && live.length === 1) {
    const s = live[0];
    redirect(s.role === "student" ? `/c/${s.slug}/portal` : `/c/${s.slug}/admin`);
  }
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <BrandMark />
        <form action={logout}>
          <button className="text-sm text-muted hover:text-ink">Sign out</button>
        </form>
      </div>
      <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
      <p className="mt-1 text-sm text-muted">Choose a workspace to continue.</p>
      <div className="mt-6 space-y-3">
        {user.isSuperAdmin && (
          <Link href="/platform" className="flex items-center justify-between rounded-xl border border-line bg-surface p-4 hover:border-brand/40">
            <span className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-brand" aria-hidden />
              <span>
                <span className="block font-medium">Platform administration</span>
                <span className="text-sm text-muted">Colleges, subscriptions, platform health</span>
              </span>
            </span>
            <ArrowRight className="h-4 w-4 text-muted" aria-hidden />
          </Link>
        )}
        {live.map((s) => (
          <Link key={s.slug} href={s.role === "student" ? `/c/${s.slug}/portal` : `/c/${s.slug}/admin`} className="flex items-center justify-between rounded-xl border border-line bg-surface p-4 hover:border-brand/40">
            <span className="flex items-center gap-3">
              {s.role === "student" ? <GraduationCap className="h-5 w-5 text-brand" aria-hidden /> : <Building2 className="h-5 w-5 text-brand" aria-hidden />}
              <span>
                <span className="block font-medium">{s.name}</span>
                <span className="text-sm text-muted">{isRole(s.role) ? ROLE_LABELS[s.role] : s.role}</span>
              </span>
            </span>
            {s.status !== "active" ? <Badge tone="red">suspended</Badge> : <ArrowRight className="h-4 w-4 text-muted" aria-hidden />}
          </Link>
        ))}
        {!live.length && !user.isSuperAdmin && <Card>Your account is not linked to any active college yet. Contact your college administrator.</Card>}
      </div>
    </main>
  );
}

function Landing() {
  const features = [
    { icon: Building2, title: "One platform, many colleges", body: "Each institution gets an isolated workspace with its own branding, records and permissions." },
    { icon: Nfc, title: "NFC student ID", body: "A tap opens the student's verified digital ID. Private records always require sign-in." },
    { icon: GraduationCap, title: "Complete academic portal", body: "Attendance, results, timetable, notices, coursework, fees, library and transport." },
  ];
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#e0e9ff,_var(--bg)_60%)]">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <header className="flex items-center justify-between">
          <BrandMark />
          <LinkButton href="/login" variant="primary">
            Sign in
          </LinkButton>
        </header>
        <section className="py-20 text-center">
          <h1 className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">The campus operating system behind every student ID card.</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted">Student records, academics and NFC digital identity for colleges and universities, with strict separation between institutions.</p>
          <div className="mt-8 flex justify-center gap-3">
            <LinkButton href="/login" variant="primary">
              Sign in to your college <ArrowRight className="h-4 w-4" aria-hidden />
            </LinkButton>
          </div>
        </section>
        <section className="grid gap-4 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-line bg-surface p-5">
              <f.icon className="h-5 w-5 text-brand" aria-hidden />
              <h2 className="mt-3 font-semibold">{f.title}</h2>
              <p className="mt-1 text-sm text-muted">{f.body}</p>
            </div>
          ))}
        </section>
        <p className="mt-16 text-center text-xs text-muted">MySmartCard Campus is a separate product from mysmartcard.net.</p>
      </div>
    </main>
  );
}
