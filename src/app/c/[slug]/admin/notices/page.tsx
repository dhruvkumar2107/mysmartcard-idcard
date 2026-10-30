import Link from "next/link";
import { GraduationCap, Plus, Users } from "lucide-react";
import { Badge, EmptyState, Flash, Input, LinkButton, PageHeader, StatusBadge, Tabs, TenantFields } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { plainPreview } from "@/components/rich-text";
import { formatDateTime, titleCase } from "@/lib/format";
import { flashOf, one, qs, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { adminNotices, noticeCounts, type NoticeAudienceType } from "@/server/services/notices";
import { noticeStatusAction } from "@/server/actions/admin";

export const metadata = { title: "Notice board" };

export default async function NoticesPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "notices.publish");
  const tab = (["students", "teachers", "archived"].includes(one(sp.tab) ?? "") ? one(sp.tab) : "students") as "students" | "teachers" | "archived";
  const q = one(sp.q);
  const audienceType: NoticeAudienceType | undefined = tab === "archived" ? undefined : tab;
  const [rows, counts] = await Promise.all([adminNotices(ctx, q, { audienceType, status: tab === "archived" ? "archived" : undefined }), noticeCounts(ctx)]);
  const base = `/c/${slug}/admin/notices`;
  const back = qs(base, { tab, q });
  const now = new Date();

  const op = (id: string, action: string, label: string, confirm?: string) => (
    <form action={noticeStatusAction}>
      <TenantFields slug={slug} back={back} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <SubmitButton variant={action === "delete" ? "ghost" : "secondary"} className={`px-2.5 py-1 text-xs ${action === "delete" ? "text-danger" : ""}`} confirm={confirm}>
        {label}
      </SubmitButton>
    </form>
  );

  return (
    <>
      <PageHeader
        title="Notice board"
        description="Student notices and teacher notices are separate boards — students never see teacher notices, and teachers do not receive student notices."
        actions={
          tab !== "archived" && (
            <LinkButton href={`${base}/new?audience=${tab}`} variant="primary">
              <Plus className="h-4 w-4" aria-hidden /> New {tab === "teachers" ? "teacher" : "student"} notice
            </LinkButton>
          )
        }
      />
      <Flash searchParams={flashOf(sp)} />
      <Tabs
        tabs={[
          { key: "students", label: `Student notices (${counts.students})` },
          { key: "teachers", label: `Teacher notices (${counts.teachers})` },
          { key: "archived", label: "Archived" },
        ]}
        active={tab}
        makeHref={(k) => `${base}?tab=${k}`}
      />
      <form className="mb-4" role="search">
        <input type="hidden" name="tab" value={tab} />
        <Input name="q" defaultValue={q} placeholder="Search notices by title" aria-label="Search notices" />
      </form>
      {rows.length === 0 ? (
        <EmptyState
          title={tab === "archived" ? "No archived notices" : `No ${tab === "teachers" ? "teacher" : "student"} notices yet`}
          description={tab === "archived" ? undefined : "Create one with an image, formatted text and a targeted audience."}
          action={tab !== "archived" && <LinkButton href={`${base}/new?audience=${tab}`}>Create notice</LinkButton>}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ notice: n, attachments, reads, author }) => {
            const scheduled = n.status === "published" && n.publishAt && n.publishAt > now;
            const expired = n.expiresAt && n.expiresAt <= now;
            return (
              <li key={n.id} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
                {n.imageFileId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/files/${n.imageFileId}`} alt="" loading="lazy" className="aspect-[16/8] w-full bg-surface-2 object-cover" style={{ objectPosition: n.imagePosition }} />
                ) : (
                  <div className="grid aspect-[16/8] place-items-center bg-gradient-to-br from-brand/10 to-accent/10 text-brand">{n.audienceType === "teachers" ? <Users className="h-8 w-8" aria-hidden /> : <GraduationCap className="h-8 w-8" aria-hidden />}</div>
                )}
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={n.status} />
                    {scheduled && <Badge tone="blue">Scheduled</Badge>}
                    {expired && <Badge tone="gray">Expired</Badge>}
                    {n.pinned && <Badge tone="violet">Pinned</Badge>}
                    <Badge>{titleCase(n.category)}</Badge>
                    {tab === "archived" && <Badge tone="amber">{n.audienceType === "teachers" ? "Teachers" : "Students"}</Badge>}
                    <Badge tone="blue">{n.audience.scope === "all" ? "Everyone" : "Targeted"}</Badge>
                  </div>
                  <Link href={`${base}/${n.id}`} className="mt-2 font-semibold hover:underline">
                    {n.title}
                  </Link>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{plainPreview(n.body, 140)}</p>
                  <p className="mt-2 text-xs text-muted">
                    {n.publishAt ? `${scheduled ? "Publishes" : "Published"} ${formatDateTime(n.publishAt)}` : `Created ${formatDateTime(n.createdAt)}`}
                    {author ? ` · by ${author}` : ""}
                    {n.status === "published" ? ` · read by ${reads}` : ""}
                    {attachments ? ` · ${attachments} attachment${attachments > 1 ? "s" : ""}` : ""}
                  </p>
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                    <LinkButton href={`${base}/${n.id}`} className="px-2.5 py-1 text-xs">
                      Edit
                    </LinkButton>
                    {n.status === "published" && op(n.id, "unpublish", "Unpublish")}
                    {n.status !== "published" && op(n.id, "publish", n.status === "archived" ? "Restore & publish" : "Publish")}
                    {n.status !== "archived" && (n.pinned ? op(n.id, "unpin", "Unpin") : op(n.id, "pin", "Pin"))}
                    {n.status !== "archived" && op(n.id, "archive", "Archive", "Archive this notice? It disappears from the board but is kept.")}
                    {op(n.id, "delete", "Delete", "Delete this notice permanently? This cannot be undone.")}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}