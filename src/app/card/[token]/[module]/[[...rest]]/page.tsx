import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { moduleVisibleToStudent } from "@/lib/portal-config";
import { one } from "@/lib/page";
import { rateLimit } from "@/lib/rate-limit";
import { PortalModule, PortalNotice, PortalShell, moduleFromSlug } from "@/components/portal";
import { orNotFound } from "@/server/session";
import { resolveCardToken } from "@/server/services/cards";
import { portalStudent, viewerForCard } from "@/server/services/portal";

export const metadata: Metadata = { title: "Student ID", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** One section of the student's record (attendance, results, fees…) opened from the NFC card link. View only. */
export default async function CardModulePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; module: string; rest?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, module, rest } = await params;
  const sp = await searchParams;
  const k = moduleFromSlug(module);
  if (!k || (rest && (k !== "notices" || rest.length > 1))) notFound();

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await rateLimit(`card:${ip}`, 60, 60_000)).ok) redirect(`/card/${token}`);
  const view = await resolveCardToken(token, { countTap: false });
  if (view.state !== "ok") redirect(`/card/${token}`);

  const v = await viewerForCard(token, view.studentId, view.institutionId);
  if (!moduleVisibleToStudent(v.config, k, (await portalStudent(v)).student)) notFound();
  const base = `/card/${token}`;
  return (
    <PortalShell v={v} base={base} active={k}>
      {rest?.[0] ? await orNotFound(PortalNotice({ v, base, id: rest[0] })) : <PortalModule v={v} k={k} q={one(sp.q)} page={Number(one(sp.page)) || 1} base={base} />}
    </PortalShell>
  );
}
