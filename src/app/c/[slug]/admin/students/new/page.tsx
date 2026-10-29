import { Flash, PageHeader } from "@/components/ui";
import { flashOf, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { listStructure } from "@/server/services/academics";
import { createStudentAction } from "@/server/actions/admin";
import { StudentForm } from "../student-form";

export const metadata = { title: "Add student" };

export default async function NewStudentPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const ctx = await requireTenant(slug, "students.edit");
  const structure = await listStructure(ctx);
  return (
    <>
      <PageHeader title="Add student" back={{ href: `/c/${slug}/admin/students`, label: "Students" }} />
      <Flash searchParams={flashOf(await searchParams)} />
      <StudentForm slug={slug} back={`/c/${slug}/admin/students/new`} action={createStudentAction} structure={structure} canSensitive={ctx.perms.has("students.view_sensitive")} />
    </>
  );
}
