import { Flash, PageHeader } from "@/components/ui";
import { NoticeEditor } from "@/components/notice-editor";
import { flashOf, one, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { createNoticeAction } from "@/server/actions/admin";
import { editorOptions } from "../editor-data";

export const metadata = { title: "New notice" };

export default async function NewNoticePage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "notices.publish");
  const audienceType = one(sp.audience) === "teachers" ? "teachers" : "students";
  const opts = await editorOptions(ctx);
  const back = `/c/${slug}/admin/notices/new?audience=${audienceType}`;
  return (
    <>
      <PageHeader title={`New ${audienceType === "teachers" ? "teacher" : "student"} notice`} back={{ href: `/c/${slug}/admin/notices?tab=${audienceType}`, label: "Notice board" }} />
      <Flash searchParams={flashOf(sp)} />
      <NoticeEditor
        action={createNoticeAction}
        slug={slug}
        back={back}
        {...opts}
        initial={{ title: "", body: "", category: "general", audienceType, scope: "all", departmentIds: [], programmeIds: [], semesters: [], sectionIds: [], publishAt: "", expiresAt: "", pinned: false, notifyEmail: false, imageUrl: null, imagePosition: "center", status: "draft" }}
      />
    </>
  );
}