import { Card, Field, Flash, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CollegeAddressFields } from "@/components/college-fields";
import { PlanPicker } from "@/components/plan-picker";
import { PLANS } from "@/lib/plans";
import { flashOf, type Props } from "@/lib/page";
import { requireSuperAdmin } from "@/server/session";
import { createInstitutionAction } from "@/server/actions/platform";

export const metadata = { title: "Onboard college" };

export default async function NewCollege({ searchParams }: Props) {
  await requireSuperAdmin();
  return (
    <>
      <PageHeader title="Onboard a college" back={{ href: "/platform", label: "Platform" }} />
      <Flash searchParams={flashOf(await searchParams)} />
      <form action={createInstitutionAction} className="space-y-6">
        <input type="hidden" name="_back" value="/platform/colleges/new" />
        <p className="text-sm text-muted">Every field is optional. Blank fields get sensible defaults and can all be filled in later.</p>
        <Card title="Institution" description="Address, contact number and principal name are printed on every student ID card. The college admin can also change them later in Settings.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Official name">
              <Input name="name" />
            </Field>
            <Field label="Short name" hint="Used on receipts and card serials. Blank = initials of the name.">
              <Input name="shortName" maxLength={40} />
            </Field>
            <Field label="Workspace slug" hint="Becomes /c/slug. Blank = generated from the name.">
              <Input name="slug" pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" title="3–40 lowercase letters, digits or hyphens" className="font-mono" />
            </Field>
            <CollegeAddressFields />
          </div>
        </Card>
        <Card title="Subscription">
          <PlanPicker plan="standard" studentLimit={PLANS.standard.studentLimit} modules={PLANS.standard.modules} />
        </Card>
        <Card title="College administrator login" description="These are the credentials you hand to the college. The college admin then sets up departments, staff, students, cards and the portal themselves. They must choose their own password at first sign-in. Optional: leave blank to add the administrator later from the college page.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name">
              <Input name="adminName" />
            </Field>
            <Field label="Login email">
              <Input name="adminEmail" type="email" />
            </Field>
            <Field label="Initial password" hint="Leave blank to generate a strong one. Min 10 characters, letters and numbers.">
              <Input name="adminPassword" type="text" autoComplete="off" minLength={10} />
            </Field>
          </div>
        </Card>
        <div className="flex justify-end">
          <SubmitButton>Create workspace</SubmitButton>
        </div>
      </form>
    </>
  );
}
