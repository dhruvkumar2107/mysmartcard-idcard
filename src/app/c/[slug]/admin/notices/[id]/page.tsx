import { Badge, Flash, PageHeader, StatusBadge } from "@/components/ui";
import { NoticeEditor } from "@/components/notice-editor";
import { formatDateTime } from "@/lib/format";
import { flashOf, type SlugProps } from "@/lib/page";
import { orNotFound, requireTenant } from "@/server/session";
import { adminNotice } from "@/server/services/notices";
import { updateNoticeAction } from "@/server/actions/admin";
import { editorOptions, localInput } from "../editor-data";

export const metadata = { title: "Edit notice" };

export default async function EditNoticePage({ params, searchParams }: SlugProps<{ id: string }>) {
  const { slug, id } = await params;
  const ctx = await requireTenant(slug, "notices.publish");
  const [{ notice: n, attachments, author, editor }, opts] = await Promise.all([orNotFound(adminNotice(ctx, id)), editorOptions(ctx)]);
  const a = n.audience;
  return (
    <>
      <PageHeader
        title="Edit notice"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={n.status} />
            <Badge tone="blue">{n.audienceType === "teachers" ? "Teacher notice" : "Student notice"}</Badge>
            <span>
              Created {formatDateTime(n.createdAt)}
              {author ? ` by ${author}` : ""} · last updated {formatDateTime(n.updatedAt)}
              {editor ? ` by ${editor}` : ""}
              {attachments.length ? ` · ${attachments.length} attachment(s)` : ""}
            </span>
          </span>
        }
        back={{ href: `/c/${slug}/admin/notices?tab=${n.status === "archived" ? "archived" : n.audienceType}`, label: "Notice board" }}
      />
      <Flash searchParams={flashOf(await searchParams)} />
      <NoticeEditor
        action={updateNoticeAction}
        slug={slug}
        back={`/c/${slug}/admin/notices/${n.id}`}
        {...opts}
        initial={{
          id: n.id,
          title: n.title,
          body: n.body,
          category: n.category,
          audienceType: n.audienceType === "teachers" ? "teachers" : "students",
          scope: a.scope,
          departmentIds: a.departmentIds ?? [],
          programmeIds: a.programmeIds ?? [],
          semesters: a.semesters ?? [],
          sectionIds: a.sectionIds ?? [],
          publishAt: localInput(n.publishAt),
          expiresAt: localInput(n.expiresAt),
          pinned: n.pinned,
          notifyEmail: n.notifyEmail,
          imageUrl: n.imageFileId ? `/api/files/${n.imageFileId}` : null,
          imagePosition: (["top", "center", "bottom"].includes(n.imagePosition) ? n.imagePosition : "center") as "center",
          status: n.status,
        }}
      />
    </>
  );
}