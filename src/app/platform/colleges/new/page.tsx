import { Card, Checkbox, Field, Flash, Input, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { MODULES } from "@/lib/portal-config";
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
        <Card title="Institution">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Official name">
              <Input name="name" required />
            </Field>
            <Field label="Short name" hint="Used on receipts and card serials">
              <Input name="shortName" required maxLength={40} />
            </Field>
            <Field label="Workspace slug" hint="Lowercase letters, digits and hyphens. Becomes /c/slug (or slug.your-domain).">
              <Input name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" className="font-mono" />
            </Field>
            <Field label="City">
              <Input name="city" />
            </Field>
            <Field label="Office email">
              <Input name="contactEmail" type="email" />
            </Field>
          </div>
        </Card>
        <Card title="Subscription">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Plan">
              <Select name="plan" defaultValue="standard" options={["starter", "standard", "enterprise"].map((p) => ({ value: p, label: p }))} />
            </Field>
            <Field label="Student limit">
              <Input name="studentLimit" type="number" min={1} defaultValue={5000} required />
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MODULES.map((m) => (
              <Checkbox key={m.key} name="modules" value={m.key} defaultChecked label={m.label} />
            ))}
          </div>
        </Card>
        <Card title="College administrator login" description="These are the credentials you hand to the college. The college admin then sets up departments, staff, students, cards and the portal themselves. They must choose their own password at first sign-in.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name">
              <Input name="adminName" required />
            </Field>
            <Field label="Login email">
              <Input name="adminEmail" type="email" required />
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
