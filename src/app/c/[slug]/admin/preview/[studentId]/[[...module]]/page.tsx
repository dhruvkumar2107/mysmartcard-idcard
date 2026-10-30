import Link from "next/link";
import { notFound } from "next/navigation";
import { moduleVisibleToStudent } from "@/lib/portal-config";
import { PortalHome, PortalModule, PortalNotice, PortalShell, moduleFromSlug } from "@/components/portal";
import { one, type SlugProps } from "@/lib/page";
import { orNotFound, requireTenant } from "@/server/session";
import { portalStudent, viewerForPreview } from "@/server/services/portal";

export const metadata = { title: "Portal preview" };

/** College-admin preview of the PUBLISHED portal for a specific student, using the same gates as the real portal (read-only). */
export default async function PreviewPage({ params, searchParams }: SlugProps<{ studentId: string; module?: string[] }>) {
  const { slug, studentId, module } = await params;
  const ctx = await requireTenant(slug, "portal.configure");
  const v = await orNotFound(viewerForPreview(ctx, studentId));
  const base = `/c/${slug}/admin/preview/${studentId}`;
  const exit = (
    <Link href={`/c/${slug}/admin/configuration?tab=portal`} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25">
      Exit preview
    </Link>
  );
  const k = module?.[0] ? moduleFromSlug(module[0]) : null;
  if (module?.[0] && !k) notFound();
  if (k && !moduleVisibleToStudent(v.config, k, (await portalStudent(v)).student)) notFound();
  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8">
      <PortalShell v={v} base={base} active={k ?? "home"} topRight={exit}>
        {k === "notices" && module?.[1] ? await orNotFound(PortalNotice({ v, base, id: module[1] })) : k ? <PortalModule v={v} k={k} q={one((await searchParams).q)} base={base} /> : <PortalHome v={v} base={base} />}
      </PortalShell>
    </div>
  );
}
