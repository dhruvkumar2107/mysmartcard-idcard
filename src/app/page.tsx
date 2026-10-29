import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Building2, GraduationCap, ShieldCheck } from "lucide-react";
import { Landing } from "@/components/landing/landing";
import { BrandMark } from "@/components/brand";
import { Badge, Card } from "@/components/ui";
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
