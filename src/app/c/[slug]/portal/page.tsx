import { redirect } from "next/navigation";
import { PortalHome, PortalShell } from "@/components/portal";
import { Flash } from "@/components/ui";
import { flashOf, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { viewerForStudent } from "@/server/services/portal";
import { SignOut } from "@/components/portal-signout";

export const metadata = { title: "Student portal" };

export default async function PortalHomePage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const ctx = await requireTenant(slug);
  if (ctx.role !== "student") redirect(`/c/${slug}/admin`);
  const v = await viewerForStudent(ctx);
  return (
    <PortalShell v={v} base={`/c/${slug}/portal`} active="home" topRight={<SignOut />}>
      <Flash searchParams={flashOf(await searchParams)} />
      <PortalHome v={v} base={`/c/${slug}/portal`} />
    </PortalShell>
  );
}
