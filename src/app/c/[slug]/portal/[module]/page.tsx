import { notFound, redirect } from "next/navigation";
import { moduleVisibleToStudent } from "@/lib/portal-config";
import { PortalModule, PortalShell, moduleFromSlug } from "@/components/portal";
import { Flash } from "@/components/ui";
import { flashOf, one, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { portalStudent, viewerForStudent } from "@/server/services/portal";
import { submitAssignmentAction } from "@/server/actions/portal";
import { SignOut } from "@/components/portal-signout";

export default async function PortalModulePage({ params, searchParams }: SlugProps<{ module: string }>) {
  const { slug, module } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug);
  if (ctx.role !== "student") redirect(`/c/${slug}/admin`);
  const k = moduleFromSlug(module);
  if (!k) notFound();
  const v = await viewerForStudent(ctx);
  // Server-side gate: a disabled module 404s even if the URL is typed directly.
  if (!moduleVisibleToStudent(v.config, k, (await portalStudent(v)).student)) notFound();
  return (
    <PortalShell v={v} base={`/c/${slug}/portal`} active={k} topRight={<SignOut />}>
      <Flash searchParams={flashOf(sp)} />
      <PortalModule v={v} k={k} q={one(sp.q)} submitAction={submitAssignmentAction} />
    </PortalShell>
  );
}
