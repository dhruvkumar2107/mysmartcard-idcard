import { notFound, redirect } from "next/navigation";
import { moduleVisibleToStudent } from "@/lib/portal-config";
import { PortalNotice, PortalShell } from "@/components/portal";
import type { SlugProps } from "@/lib/page";
import { orNotFound, requireTenant } from "@/server/session";
import { portalStudent, viewerForStudent } from "@/server/services/portal";
import { SignOut } from "@/components/portal-signout";

export const metadata = { title: "Notice" };

/** Full notice view. Only /portal/notices/<id> exists; other sections have no detail pages. */
export default async function PortalNoticePage({ params }: SlugProps<{ module: string; id: string }>) {
  const { slug, module, id } = await params;
  if (module !== "notices") notFound();
  const ctx = await requireTenant(slug);
  if (ctx.role !== "student") redirect(`/c/${slug}/admin`);
  const v = await viewerForStudent(ctx);
  if (!moduleVisibleToStudent(v.config, "notices", (await portalStudent(v)).student)) notFound();
  return (
    <PortalShell v={v} base={`/c/${slug}/portal`} active="notices" topRight={<SignOut />}>
      {await orNotFound(PortalNotice({ v, base: `/c/${slug}/portal`, id }))}
    </PortalShell>
  );
}
