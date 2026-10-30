import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { NoticeDetail } from "@/components/views";
import { MarkNoticeRead } from "@/components/notifications";
import type { SlugProps } from "@/lib/page";
import { orNotFound, requireTenant } from "@/server/session";
import { noticeForViewer, noticeViewer } from "@/server/services/notices";

export const metadata = { title: "Notice" };

export default async function StaffNoticePage({ params }: SlugProps<{ id: string }>) {
  const { slug, id } = await params;
  const ctx = await requireTenant(slug);
  const v = await noticeViewer(ctx);
  if (!v || v.kind !== "teacher") notFound();
  const n = await orNotFound(noticeForViewer(ctx, v, id));
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/c/${slug}/admin/staff-notices`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Staff notices
      </Link>
      <NoticeDetail n={n} fileHref={(f) => `/api/files/${f}`} />
      <MarkNoticeRead slug={slug} id={n.id} unread={n.unread} />
    </div>
  );
}
