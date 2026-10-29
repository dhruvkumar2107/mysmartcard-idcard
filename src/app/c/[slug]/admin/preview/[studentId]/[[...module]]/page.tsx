import Link from "next/link";
import { notFound } from "next/navigation";
import { moduleVisibleToStudent } from "@/lib/portal-config";
import { PortalHome, PortalModule, PortalShell, moduleFromSlug } from "@/components/portal";
import { one, type SlugProps } from "@/lib/page";
import { orNotFound, requireTenant } from "@/server/session";
import { portalStudent, viewerForPreview } from "@/server/services/portal";

export const metadata = { title: "Portal preview" };

/** Admin preview of the DRAFT portal config for a specific student, using the same gate as the real portal. */
export default async function PreviewPage({ params, searchParams }: SlugProps<{ studentId: string; module?: string[] }>) {
  const { slug, studentId, module } = await params;
  const ctx = await requireTenant(slug, "portal.configure");
  const v = await orNotFound(viewerForPreview(ctx, studentId));
  const base = `/c/${slug}/admin/preview/${studentId}`;
  const exit = (
    <Link href={`/c/${slug}/admin/portal-designer`} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25">
      Exit preview
    </Link>
  );
  const k = module?.[0] ? moduleFromSlug(module[0]) : null;
  if (module?.[0] && !k) notFound();
  if (k && !moduleVisibleToStudent(v.config, k, (await portalStudent(v)).student)) notFound();
  return (
    <div className="-mx-4 -my-6 sm:-mx-6 lg:-mx-8">
      <PortalShell v={v} base={base} active={k ?? "home"} topRight={exit}>
        {k ? <PortalModule v={v} k={k} q={one((await searchParams).q)} /> : <PortalHome v={v} base={base} />}
      </PortalShell>
    </div>
  );
}
