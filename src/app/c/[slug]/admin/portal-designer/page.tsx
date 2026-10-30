import { redirect } from "next/navigation";
import type { SlugProps } from "@/lib/page";

/** The portal designer moved: modules/branding to the platform Portal Builder, the rest to Configuration. */
export default async function PortalDesignerMoved({ params }: SlugProps) {
  const { slug } = await params;
  redirect(`/c/${slug}/admin/configuration`);
}
