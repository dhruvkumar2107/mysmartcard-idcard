import { Alert, Card, Flash, KV, PageHeader, StatusBadge } from "@/components/ui";
import { MODULES } from "@/lib/portal-config";
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
              ["Plan", i.plan],
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
      <div className="mt-6">
        <Alert tone="info">Data retention: archived student records are kept for audit purposes and can be restored from the Students page. Permanent deletion requests should be raised with platform support so backups are handled consistently.</Alert>
      </div>
    </>
  );
}
