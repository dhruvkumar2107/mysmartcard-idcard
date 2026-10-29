import { Card, EmptyState, Field, Flash, Input, PageHeader, Select, StatusBadge, Table, Td, TenantFields, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { OneTimeCredential } from "@/components/server-bits";
import { ROLE_LABELS, ROLES, isRole } from "@/lib/permissions";
import { flashOf, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { listFaculty } from "@/server/services/people";
import { listStructure } from "@/server/services/academics";
import { createFacultyAction, grantStaffAccessAction } from "@/server/actions/admin";

export const metadata = { title: "Faculty" };

export default async function FacultyPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const ctx = await requireTenant(slug, "faculty.view");
  const [rows, s] = await Promise.all([listFaculty(ctx), listStructure(ctx)]);
  const back = `/c/${slug}/admin/faculty`;
  const canEdit = ctx.perms.has("faculty.edit");
  const canGrant = ctx.perms.has("users.manage");
  const staffRoles = ROLES.filter((r) => r !== "student").map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  return (
    <>
      <PageHeader title="Faculty" description={ctx.scope.kind === "department" ? "Faculty in your department." : "Teaching staff records and their portal accounts."} />
      <Flash searchParams={flashOf(await searchParams)} />
      <OneTimeCredential />
      {canEdit && (
        <Card title="Add faculty member" className="mb-6">
          <form action={createFacultyAction} className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <TenantFields slug={slug} back={back} />
            <Field label="Employee code">
              <Input name="employeeCode" required className="uppercase" />
            </Field>
            <Field label="Name" className="lg:col-span-2">
              <Input name="name" required />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" />
            </Field>
            <Field label="Designation">
              <Input name="designation" placeholder="Assistant Professor" />
            </Field>
            <Field label="Department">
              <Select name="departmentId" placeholder="—" options={s.departments.map((d) => ({ value: d.id, label: d.code }))} />
            </Field>
            <div className="sm:col-span-3 lg:col-span-6">
              <SubmitButton>Add faculty</SubmitButton>
            </div>
          </form>
        </Card>
      )}
      <Card padded={false}>
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No faculty records yet" />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Code</Th>
                <Th>Department</Th>
                <Th>Designation</Th>
                <Th>Status</Th>
                <Th>Portal role</Th>
                {canGrant && <Th>Grant access</Th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.faculty.id}>
                  <Td>
                    <div className="font-medium">{r.faculty.name}</div>
                    <div className="text-xs text-muted">{r.faculty.email ?? "No email"}</div>
                  </Td>
                  <Td className="font-mono text-xs">{r.faculty.employeeCode}</Td>
                  <Td>{r.departmentCode ?? "—"}</Td>
                  <Td>{r.faculty.designation ?? "—"}</Td>
                  <Td>
                    <StatusBadge status={r.faculty.status} />
                  </Td>
                  <Td>{r.role && isRole(r.role) ? ROLE_LABELS[r.role] : <span className="text-muted">No account</span>}</Td>
                  {canGrant && (
                    <Td>
                      <form action={grantStaffAccessAction} className="flex gap-2">
                        <TenantFields slug={slug} back={back} />
                        <input type="hidden" name="id" value={r.faculty.id} />
                        <Select name="role" defaultValue={r.role ?? "faculty"} options={staffRoles} className="w-auto py-1.5 text-xs" aria-label="Role" />
                        <SubmitButton variant="secondary" className="py-1.5 text-xs">
                          {r.role ? "Update" : "Grant"}
                        </SubmitButton>
                      </form>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
