import { Alert, Card, Field, Flash, Input, KV, PageHeader, Select, StatusBadge, TenantFields } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { MODULES } from "@/lib/portal-config";
import { formatDateTime } from "@/lib/format";
import { flashOf, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { supportGrantsFor } from "@/server/services/settings";
import { grantSupportAction, revokeSupportAction } from "@/server/actions/admin";

export const metadata = { title: "Settings & support" };

export default async function SettingsPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const ctx = await requireTenant(slug, "support.grant");
  const grants = await supportGrantsFor(ctx);
  const back = `/c/${slug}/admin/settings`;
  const i = ctx.institution;
  return (
    <>
      <PageHeader title="Settings & support access" />
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
        <Card title="Platform support access" description="Platform staff cannot see your college's data unless you grant time-limited, read-only access here. Every grant and every support session is audited.">
          <form action={grantSupportAction} className="grid gap-3 sm:grid-cols-3">
            <TenantFields slug={slug} back={back} />
            <Field label="Duration">
              <Select name="hours" options={[1, 4, 24, 72].map((h) => ({ value: String(h), label: `${h} hour${h > 1 ? "s" : ""}` }))} />
            </Field>
            <Field label="Reason" className="sm:col-span-2">
              <Input name="reason" required minLength={5} placeholder="Ticket #1234 — import troubleshooting" />
            </Field>
            <div>
              <SubmitButton variant="secondary">Grant access</SubmitButton>
            </div>
          </form>
          <ul className="mt-4 divide-y divide-line text-sm">
            {grants.map((g) => (
              <li key={g.grant.id} className="flex items-center justify-between gap-2 py-2.5">
                <span>
                  {g.grant.reason}
                  <span className="block text-xs text-muted">
                    by {g.grantedBy ?? "—"} · until {formatDateTime(g.grant.expiresAt)}
                  </span>
                </span>
                {g.active ? (
                  <form action={revokeSupportAction}>
                    <TenantFields slug={slug} back={back} />
                    <input type="hidden" name="id" value={g.grant.id} />
                    <SubmitButton variant="danger" className="px-2 py-1 text-xs">
                      Revoke
                    </SubmitButton>
                  </form>
                ) : (
                  <StatusBadge status={g.grant.revokedAt ? "revoked" : "inactive"} />
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="mt-6">
        <Alert tone="info">Data retention: archived student records are kept for audit purposes and can be restored from the Students page. Permanent deletion requests should be raised with platform support so backups are handled consistently.</Alert>
      </div>
    </>
  );
}
