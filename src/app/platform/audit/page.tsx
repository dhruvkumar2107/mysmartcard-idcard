import { Badge, Card, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireSuperAdmin } from "@/server/session";
import { platformAuditLog } from "@/server/services/platform";

export const metadata = { title: "Platform audit" };

export default async function PlatformAudit() {
  const user = await requireSuperAdmin();
  const rows = await platformAuditLog(user, 200);
  // Platform operators see event metadata (who/what/when) but the summaries of tenant-internal
  // academic events are limited to platform-level actions to avoid leaking student data.
  const platformLevel = new Set(["institution", "support_grant", "membership", "portal_config", "institution_settings"]);
  return (
    <>
      <PageHeader title="Platform audit events" description="Onboarding, suspension, subscription, support-access and permission events across all colleges." />
      <Card padded={false}>
        <ul className="divide-y divide-line">
          {rows
            .filter((r) => platformLevel.has(r.log.entityType))
            .map((r) => (
              <li key={r.log.id} className="px-5 py-3 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="font-medium">{r.log.summary}</span>
                  <span className="text-xs text-muted">{formatDateTime(r.log.createdAt)}</span>
                </div>
                <div className="text-xs text-muted">
                  <Badge>{r.log.action}</Badge> {r.institution ?? "Platform"} · {r.log.actorName ?? "system"}
                </div>
              </li>
            ))}
        </ul>
      </Card>
    </>
  );
}
