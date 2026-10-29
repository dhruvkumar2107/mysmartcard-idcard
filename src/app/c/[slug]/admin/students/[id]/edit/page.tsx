import { Flash, PageHeader } from "@/components/ui";
import { flashOf, type SlugProps } from "@/lib/page";
import { orNotFound, requireTenant } from "@/server/session";
import { listStructure } from "@/server/services/academics";
import { getStudent } from "@/server/services/students";
import { updateStudentAction } from "@/server/actions/admin";
import { StudentForm } from "../../student-form";

export const metadata = { title: "Edit student" };

export default async function EditStudentPage({ params, searchParams }: SlugProps<{ id: string }>) {
  const { slug, id } = await params;
  const ctx = await requireTenant(slug, "students.edit");
  const [{ student }, structure] = await Promise.all([orNotFound(getStudent(ctx, id)), listStructure(ctx)]);
  return (
    <>
      <PageHeader title={`Edit ${student.fullName}`} back={{ href: `/c/${slug}/admin/students/${id}`, label: "Profile" }} />
      <Flash searchParams={flashOf(await searchParams)} />
      <StudentForm slug={slug} back={`/c/${slug}/admin/students/${id}/edit`} action={updateStudentAction} structure={structure} student={student} canSensitive={ctx.perms.has("students.view_sensitive")} />
    </>
  );
}
