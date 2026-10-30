import Link from "next/link";
import { notFound } from "next/navigation";
import { moduleVisibleToStudent } from "@/lib/portal-config";
import { PortalHome, PortalModule, PortalNotice, PortalShell, moduleFromSlug } from "@/components/portal";
import { one, type Props } from "@/lib/page";
import { orNotFound, requireSuperAdmin } from "@/server/session";
import { portalStudent, viewerForPlatformPreview } from "@/server/services/portal";
import { platformPreviewContext } from "@/server/services/portal-preview";

export const metadata = { title: "Portal preview" };

export default async function PlatformPreview({ params, searchParams }: Props<{ collegeId: string; layer: string; studentId: string; module?: string[] }>) {
  const { collegeId, layer, studentId, module } = await params;
  const user = await requireSuperAdmin();
  if (layer !== "college" && layer !== "global") notFound();
  const { ctx, config } = await orNotFound(platformPreviewContext(user, collegeId, layer));
  const v = await orNotFound(viewerForPlatformPreview(ctx, studentId, config));
  const base = `/platform/portal/preview/${collegeId}/${layer}/${studentId}`;
  const k = module?.[0] ? moduleFromSlug(module[0]) : null;
  if (module?.[0] && !k) notFound();
  if (k && !moduleVisibleToStudent(v.config, k, (await portalStudent(v)).student)) notFound();
  const exit = (
    <Link href={`/platform/portal?college=${collegeId}`} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium hover:bg-white/25">
      Exit preview
    </Link>
  );
  return (
    <div className="-mx-4 -my-6 sm:-mx-6">
      <PortalShell v={v} base={base} active={k ?? "home"} topRight={exit}>
        {k === "notices" && module?.[1] ? await orNotFound(PortalNotice({ v, base, id: module[1] })) : k ? <PortalModule v={v} k={k} q={one((await searchParams).q)} base={base} /> : <PortalHome v={v} base={base} />}
      </PortalShell>
    </div>
  );
}
