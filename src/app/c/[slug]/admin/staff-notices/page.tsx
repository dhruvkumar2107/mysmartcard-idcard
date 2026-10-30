import { notFound } from "next/navigation";
import { EmptyState, Input, LinkButton, PageHeader } from "@/components/ui";
import { NoticesView } from "@/components/views";
import { one, qs, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { noticeFeed, noticeViewer } from "@/server/services/notices";

export const metadata = { title: "Staff notices" };

/** Teacher notice board (faculty, HODs, principal). Student notices never appear here. */
export default async function StaffNoticesPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug);
  const v = await noticeViewer(ctx);
  if (!v || v.kind !== "teacher") notFound();
  const q = one(sp.q);
  const f = await noticeFeed(ctx, v, { q, page: Number(one(sp.page)) || 1, pageSize: 12 });
  const base = `/c/${slug}/admin/staff-notices`;
  return (
    <>
      <PageHeader title="Staff notices" description={f.unread ? `${f.unread} unread` : "You're all caught up."} />
      <form className="mb-4" role="search">
        <Input name="q" defaultValue={q} placeholder="Search notices" aria-label="Search notices" />
      </form>
      {f.items.length === 0 ? (
        <EmptyState title={q ? "No notices match your search" : "No staff notices yet"} />
      ) : (
        <NoticesView notices={f.items} fileHref={(id) => `/api/files/${id}`} hrefFor={(id) => `${base}/${id}`} />
      )}
      {f.pages > 1 && (
        <nav className="mt-5 flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-muted">
            Page {f.page} of {f.pages}
          </span>
          <div className="flex gap-2">
            {f.page > 1 && <LinkButton href={qs(base, { q, page: f.page - 1 })}>Newer</LinkButton>}
            {f.page < f.pages && <LinkButton href={qs(base, { q, page: f.page + 1 })}>Older</LinkButton>}
          </div>
        </nav>
      )}
    </>
  );
}
