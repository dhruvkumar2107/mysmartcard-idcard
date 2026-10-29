import { Badge, Card, Checkbox, Field, Flash, Input, KV, PageHeader, Select, Stat, StatusBadge } from "@/components/ui";
import { CopyButton, SubmitButton } from "@/components/client";
import { MODULES } from "@/lib/portal-config";
import { formatDateTime } from "@/lib/format";
import { flashOf, type Props } from "@/lib/page";
import { orNotFound, requireSuperAdmin } from "@/server/session";
import { getInstitution } from "@/server/services/platform";
import { hasActiveSupportGrant } from "@/server/services/settings";
import { appUrl } from "@/server/services/cards";
import { addCollegeAdminAction, resetAdminPasswordAction, setInstitutionStatusAction, updateInstitutionDetailsAction, updateSubscriptionAction } from "@/server/actions/platform";
import { OneTimeCredential } from "@/components/server-bits";

export const metadata = { title: "College" };

export default async function CollegeDetail({ params, searchParams }: Props<{ id: string }>) {
  const { id } = await params;
  const user = await requireSuperAdmin();
  const { inst, admins, usage } = await orNotFound(getInstitution(user, id));
  const support = await hasActiveSupportGrant(inst.id);
  const back = `/platform/colleges/${id}`;
  const loginUrl = `${appUrl()}/login?next=${encodeURIComponent(`/c/${inst.slug}/admin`)}`;
  return (
    <>
      <PageHeader title={inst.name} description={`/c/${inst.slug}`} back={{ href: "/platform", label: "Platform" }} actions={<StatusBadge status={inst.status} />} />
      <Flash searchParams={flashOf(await searchParams)} />
      <OneTimeCredential />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Students" value={usage.students.toLocaleString("en-IN")} hint={`limit ${inst.studentLimit.toLocaleString("en-IN")}`} />
        <Stat label="Faculty" value={usage.faculty.toLocaleString("en-IN")} />
        <Stat label="Staff accounts" value={usage.staffAccounts.toLocaleString("en-IN")} />
        <Stat label="Active NFC cards" value={usage.activeCards.toLocaleString("en-IN")} hint={`${usage.totalCards.toLocaleString("en-IN")} issued in total`} />
      </div>

      <Card title="College admin credentials" description="Hand these to the college. Everything inside the college — departments, staff, students, cards, portal — is managed by its administrators." className="mb-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-2 px-3 py-2 text-xs">{loginUrl}</code>
          <CopyButton text={loginUrl} label="Copy login link" />
        </div>
        <ul className="divide-y divide-line">
          {admins.map((a) => (
            <li key={a.userId} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="text-sm">
                <span className="font-medium">{a.name}</span> <span className="text-muted">{a.email}</span> <StatusBadge status={a.status} />
                <div className="text-xs text-muted">
                  {a.lastLoginAt ? `Last sign-in ${formatDateTime(a.lastLoginAt)}` : "Never signed in"}
                  {a.mustChangePassword && (
                    <>
                      {" "}
                      · <Badge tone="amber">must set own password</Badge>
                    </>
                  )}
                </div>
              </div>
              <form action={resetAdminPasswordAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="_back" value={back} />
                <input type="hidden" name="id" value={inst.id} />
                <input type="hidden" name="userId" value={a.userId} />
                <Input name="password" placeholder="New password (blank = generate)" autoComplete="off" className="w-64 py-1.5 text-xs" aria-label="New password" />
                <SubmitButton variant="secondary" className="py-1.5 text-xs" confirm={`Reset the password for ${a.email}? They will be signed out everywhere.`}>
                  Reset password
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
        <form action={addCollegeAdminAction} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-4">
          <input type="hidden" name="_back" value={back} />
          <input type="hidden" name="id" value={inst.id} />
          <Field label="Name">
            <Input name="name" required />
          </Field>
          <Field label="Login email">
            <Input name="email" type="email" required />
          </Field>
          <Field label="Initial password" hint="Blank = generate">
            <Input name="password" autoComplete="off" />
          </Field>
          <div className="flex items-end">
            <SubmitButton variant="secondary">Add college admin</SubmitButton>
          </div>
        </form>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="College details">
          <form action={updateInstitutionDetailsAction} className="space-y-3">
            <input type="hidden" name="_back" value={back} />
            <input type="hidden" name="id" value={inst.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="College name" className="sm:col-span-2">
                <Input name="name" defaultValue={inst.name} required minLength={3} />
              </Field>
              <Field label="Short name">
                <Input name="shortName" defaultValue={inst.shortName} required minLength={2} />
              </Field>
              <Field label="City">
                <Input name="city" defaultValue={inst.city ?? ""} />
              </Field>
              <Field label="Office email" className="sm:col-span-2">
                <Input name="contactEmail" type="email" defaultValue={inst.contactEmail ?? ""} />
              </Field>
            </div>
            <SubmitButton variant="secondary">Save details</SubmitButton>
          </form>
          <div className="mt-4 border-t border-line pt-4">
            <KV
              items={[
                ["Created", formatDateTime(inst.createdAt)],
                ["Support access", support ? "Granted (read-only)" : "Not granted. College records are not visible to platform staff"],
              ]}
            />
          </div>
        </Card>
        <Card title={inst.status === "active" ? "Suspend college" : "Reactivate college"}>
          <form action={setInstitutionStatusAction} className="space-y-3">
            <input type="hidden" name="_back" value={back} />
            <input type="hidden" name="id" value={inst.id} />
            <input type="hidden" name="status" value={inst.status === "active" ? "suspended" : "active"} />
            <Field label="Reason (recorded in audit log)">
              <Input name="reason" required minLength={3} />
            </Field>
            <SubmitButton variant={inst.status === "active" ? "danger" : "primary"} confirm={inst.status === "active" ? "Suspend this college? All of its users lose workspace access and its NFC cards stop resolving." : undefined}>
              {inst.status === "active" ? "Suspend" : "Reactivate"}
            </SubmitButton>
          </form>
        </Card>
        <Card title="Subscription & modules" className="lg:col-span-2">
          <form action={updateSubscriptionAction} className="space-y-4">
            <input type="hidden" name="_back" value={back} />
            <input type="hidden" name="id" value={inst.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Plan">
                <Select name="plan" defaultValue={inst.plan} options={["starter", "standard", "enterprise"].map((p) => ({ value: p, label: p }))} />
              </Field>
              <Field label="Student limit">
                <Input name="studentLimit" type="number" min={1} defaultValue={inst.studentLimit} required />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {MODULES.map((m) => (
                <Checkbox key={m.key} name="modules" value={m.key} defaultChecked={inst.licensedModules.includes(m.key)} label={m.label} />
              ))}
            </div>
            <p className="text-xs text-muted">Removing a module from the subscription disables it in the college&apos;s portal immediately, regardless of the college&apos;s own settings.</p>
            <SubmitButton>Save subscription</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}
