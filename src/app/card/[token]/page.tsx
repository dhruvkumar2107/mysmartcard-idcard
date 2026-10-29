import type { Metadata } from "next";
import { headers } from "next/headers";
import { Lock, ShieldCheck, ShieldX, UserRound } from "lucide-react";
import { DigitalIdCard } from "@/components/views";
import { LinkButton } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { PUBLIC_DETAIL_FIELDS, PUBLIC_FIELDS } from "@/lib/portal-config";
import { rateLimit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import { loadTenantContext } from "@/server/context";
import { getSessionUser } from "@/server/session";
import { resolveCardToken } from "@/server/services/cards";

export const metadata: Metadata = { title: "Student ID", robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Public NFC landing page. Shows ONLY the fields the college marked public.
 * Tapping a card is treated as "find this student's portal", never as
 * authentication; private records sit behind sign-in.
 */
export default async function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`card:${ip}`, 60, 60_000);
  if (!rl.ok)
    return (
      <Shell>
        <ShieldX className="mx-auto h-10 w-10 text-danger" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">Too many requests</h1>
        <p className="mt-1 text-sm text-muted">Please wait {rl.retryAfterSec} seconds and try again.</p>
      </Shell>
    );

  const view = await resolveCardToken(token);
  if (view.state === "invalid")
    return (
      <Shell>
        <ShieldX className="mx-auto h-10 w-10 text-danger" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">Card not recognised</h1>
        <p className="mt-1 text-sm text-muted">This link is invalid or has been revoked. If this is your card, contact your college office for a replacement.</p>
      </Shell>
    );
  if (view.state === "inactive")
    return (
      <Shell>
        <ShieldX className="mx-auto h-10 w-10 text-warn" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">Card not active</h1>
        <p className="mt-1 text-sm text-muted">This {view.institution.name} ID card is currently not active or has expired.</p>
      </Shell>
    );

  const f = view.fields;
  const details = PUBLIC_DETAIL_FIELDS.flatMap((key): [string, string][] => {
    const value = f[key];
    if (!value) return [];
    const label = PUBLIC_FIELDS.find((p) => p.key === key)!.label;
    return [[label, key === "dateOfBirth" ? formatDate(value) : value]];
  });
  const viewer = await viewerRole(view.institution.slug, view.studentId);
  return (
    <main className="min-h-screen bg-bg px-4 py-8" style={{ ["--brand" as string]: view.branding.primaryColor, ["--accent" as string]: view.branding.accentColor }}>
      <div className="mx-auto max-w-sm">
        <div className="mb-4 flex items-center justify-center gap-1.5 text-sm font-medium text-ok">
          <ShieldCheck className="h-4 w-4" aria-hidden /> Verified {view.institution.shortName} student ID
        </div>
        <DigitalIdCard
          college={{ name: view.institution.name, logoUrl: view.branding.logoFileId ? `/api/files/${view.branding.logoFileId}` : null }}
          student={{
            fullName: f.fullName ?? "Student",
            enrollmentNo: f.enrollmentNo ?? "••••••",
            department: f.department,
            programme: f.programme,
            semester: f.semester,
            academicYear: f.academicYear,
            status: f.status ?? "active",
            bloodGroup: f.bloodGroup,
          }}
          photoUrl={view.photoAvailable ? `/card/${token}/photo` : null}
          card={"cardValidity" in f ? { status: view.cardStatus, validUntil: f.cardValidity } : null}
          brand={view.branding.primaryColor}
          details={details}
        />
        <div className="mt-6 rounded-xl border border-line bg-surface p-4 text-center">
          {viewer === "staff" ? (
            <>
              <UserRound className="mx-auto h-5 w-5 text-muted" aria-hidden />
              <p className="mt-2 text-sm">You are signed in as {view.institution.shortName} staff.</p>
              <LinkButton href={`/c/${view.institution.slug}/admin/students/${view.studentId}`} variant="primary" className="mt-3 w-full">
                View full student record
              </LinkButton>
            </>
          ) : viewer === "owner" ? (
            <>
              <UserRound className="mx-auto h-5 w-5 text-muted" aria-hidden />
              <p className="mt-2 text-sm">This is your card. Your attendance, results, fees and more are in your portal.</p>
              <LinkButton href={`/c/${view.institution.slug}/portal`} variant="primary" className="mt-3 w-full">
                Open my student portal
              </LinkButton>
            </>
          ) : (
            <>
              <Lock className="mx-auto h-5 w-5 text-muted" aria-hidden />
              <p className="mt-2 text-sm">Is this your card? Sign in to view attendance, results, fees and more.</p>
              <LinkButton href={`/login?next=${encodeURIComponent(`/c/${view.institution.slug}/portal`)}`} variant="primary" className="mt-3 w-full">
                Open my student portal
              </LinkButton>
            </>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted">Verified {formatDate(new Date(), { dateStyle: "medium", timeStyle: "short" })} · MySmartCard Campus</p>
      </div>
    </main>
  );
}

/**
 * Who is tapping: the card's own student, college staff allowed to view
 * students, or anyone else. Only changes which link is offered; the linked
 * pages run their own authorization.
 */
async function viewerRole(slug: string, studentId: string): Promise<"owner" | "staff" | "public"> {
  const user = await getSessionUser();
  if (!user) return "public";
  try {
    const ctx = await loadTenantContext(user, slug);
    if (ctx.studentId) return ctx.studentId === studentId ? "owner" : "public";
    return ctx.perms.has("students.view") ? "staff" : "public";
  } catch (e) {
    if (e instanceof AppError) return "public";
    throw e;
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="max-w-sm text-center">{children}</div>
    </main>
  );
}
