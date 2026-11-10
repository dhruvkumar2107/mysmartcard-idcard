import { Alert, Card, Field, Flash, Input, KV, PageHeader, Select, StatusBadge, Textarea, TenantFields } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { saveIdCardDetailsAction } from "@/server/actions/admin";
import { MODULES } from "@/lib/portal-config";
import { INDIAN_STATES, planLabel, PLANS, type PlanKey } from "@/lib/plans";
import { flashOf, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const ctx = await requireTenant(slug, "support.grant");
  const i = ctx.institution;
  return (
    <>
      <PageHeader title="Settings" />
      <Flash searchParams={flashOf(await searchParams)} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Subscription" description="Managed by MySmartCard platform administration.">
          <KV
            items={[
              ["College", i.name],
              ["Workspace URL", `/c/${i.slug}`],
              ["Plan", PLANS[i.plan as PlanKey] ? `${planLabel(i.plan)} — ${PLANS[i.plan as PlanKey].summary}` : i.plan],
              ["Status", <StatusBadge key="s" status={i.status} />],
              ["Student limit", i.studentLimit.toLocaleString("en-IN")],
              ["Licensed modules", i.licensedModules.map((k) => MODULES.find((m) => m.key === k)?.label ?? k).join(", ")],
            ]}
          />
        </Card>
        <Card title="MySmartCard platform access" description="The MySmartCard super admin manages the student portal for every college and can open this workspace to help administer it.">
          <div className="space-y-3 text-sm">
            <p>Every action the platform takes here — including viewing previews as a student, changing records and publishing portal settings — is written to your audit log, attributed to “(MySmartCard platform)”.</p>
            <p>
              <a href={`/c/${slug}/admin/audit`} className="font-medium text-brand hover:underline">
                Review platform activity in the audit log →
              </a>
            </p>
          </div>
        </Card>
      </div>
      {ctx.perms.has("portal.configure") && (
        <div className="mt-6">
          <Card title="ID card details" description="Printed on every student ID card: college address (with city, state and PIN code), contact number and the principal's signature.">
            <form action={saveIdCardDetailsAction} encType="multipart/form-data" className="grid gap-4 sm:grid-cols-2">
              <TenantFields slug={slug} back={`/c/${slug}/admin/settings`} />
              <Field label="College address" className="sm:col-span-2">
                <Textarea name="address" rows={2} maxLength={300} defaultValue={i.address ?? ""} />
              </Field>
              <Field label="City">
                <Input name="city" maxLength={80} defaultValue={i.city ?? ""} />
              </Field>
              <Field label="State">
                <Select name="state" placeholder="Select state" defaultValue={i.state ?? ""} options={INDIAN_STATES.map((st) => ({ value: st, label: st }))} />
              </Field>
              <Field label="PIN code">
                <Input name="pincode" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} title="6-digit PIN code" defaultValue={i.pincode ?? ""} />
              </Field>
              <Field label="College contact number">
                <Input name="contactPhone" type="tel" maxLength={30} defaultValue={i.contactPhone ?? ""} />
              </Field>
              <Field label="Principal name">
                <Input name="principalName" maxLength={120} defaultValue={i.principalName ?? ""} />
              </Field>
              <Field label="Principal signature" hint="PNG with transparent background works best · max 2 MB" className="sm:col-span-2">
                <div className="flex flex-wrap items-center gap-3">
                  {i.principalSignatureFileId && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${i.principalSignatureFileId}`} alt="Current principal signature" className="h-12 max-w-[12rem] rounded border border-line bg-white object-contain p-1" />
                  )}
                  <Input type="file" name="signature" accept="image/png,image/jpeg,image/webp" />
                  {i.principalSignatureFileId && (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="removeSignature" /> Remove signature
                    </label>
                  )}
                </div>
              </Field>
              <div className="flex justify-end sm:col-span-2">
                <SubmitButton>Save ID card details</SubmitButton>
              </div>
            </form>
          </Card>
        </div>
      )}
      <div className="mt-6">
        <Alert tone="info">Data retention: archived student records are kept for audit purposes and can be restored from the Students page. Permanent deletion requests should be raised with platform support so backups are handled consistently.</Alert>
      </div>
    </>
  );
}
