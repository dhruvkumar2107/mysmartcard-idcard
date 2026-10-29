import { Card, Field, Flash, Input, PageHeader, Select, StatusBadge, Table, Td, TenantFields, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { OneTimeCredential } from "@/components/server-bits";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS, ROLES, isRole } from "@/lib/permissions";
import { flashOf, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { listStaff } from "@/server/services/people";
import { listStructure } from "@/server/services/academics";
import { createStaffUserAction, updateMembershipAction } from "@/server/actions/admin";

export const metadata = { title: "Staff accounts" };

export default async function UsersPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const ctx = await requireTenant(slug, "users.manage");
  const [rows, s] = await Promise.all([listStaff(ctx), listStructure(ctx)]);
  const back = `/c/${slug}/admin/users`;
  const staffRoles = ROLES.filter((r) => r !== "student").map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  const deps = s.departments.map((d) => ({ value: d.id, label: d.code }));
  const staff = rows.filter((r) => r.membership.role !== "student");
  const studentCount = rows.length - staff.length;

  return (
    <>
      <PageHeader title="Staff accounts & roles" description={`${staff.length} staff account(s) · ${studentCount} student portal account(s). Role permissions can be tuned in Portal designer → Roles.`} />
      <Flash searchParams={flashOf(await searchParams)} />
      <OneTimeCredential />
      <Card title="Create staff account" className="mb-6">
        <form action={createStaffUserAction} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <TenantFields slug={slug} back={back} />
          <Field label="Name">
            <Input name="name" required />
          </Field>
          <Field label="Email">
            <Input name="email" type="email" required />
          </Field>
          <Field label="Role">
            <Select name="role" options={staffRoles} defaultValue="accountant" />
          </Field>
          <Field label="Department (HOD only)">
            <Select name="departmentId" placeholder="—" options={deps} />
          </Field>
          <div className="flex items-end">
            <SubmitButton>Create</SubmitButton>
          </div>
        </form>
      </Card>
      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Last sign-in</Th>
              <Th>Current role</Th>
              <Th>Change</Th>
            </tr>
          </thead>
          <tbody>
            {staff.map((r) => (
              <tr key={r.membership.id}>
                <Td>
                  <div className="font-medium">{r.user.name}</div>
                  <div className="text-xs text-muted">{r.user.email}</div>
                </Td>
                <Td className="text-xs text-muted">{r.user.lastLoginAt ? formatDateTime(r.user.lastLoginAt) : "Never"}</Td>
                <Td>
                  {isRole(r.membership.role) ? ROLE_LABELS[r.membership.role] : r.membership.role}
                  {r.departmentCode && <span className="text-muted"> · {r.departmentCode}</span>} <StatusBadge status={r.membership.status} />
                </Td>
                <Td>
                  <form action={updateMembershipAction} className="flex flex-wrap gap-2">
                    <TenantFields slug={slug} back={back} />
                    <input type="hidden" name="id" value={r.membership.id} />
                    <Select name="role" defaultValue={r.membership.role} options={staffRoles} className="w-auto py-1.5 text-xs" aria-label="Role" />
                    <Select name="departmentId" defaultValue={r.membership.departmentId ?? ""} placeholder="Dept" options={deps} className="w-auto py-1.5 text-xs" aria-label="Department" />
                    <Select name="status" defaultValue={r.membership.status} options={[{ value: "active", label: "Active" }, { value: "disabled", label: "Disabled" }]} className="w-auto py-1.5 text-xs" aria-label="Status" />
                    <SubmitButton variant="secondary" className="py-1.5 text-xs" confirm="Change this person's access?">
                      Save
                    </SubmitButton>
                  </form>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
