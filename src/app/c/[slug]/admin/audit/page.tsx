import { Badge, Card, EmptyState, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { one, qs, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { auditLog } from "@/server/services/settings";

export const metadata = { title: "Audit log" };

const TYPES = ["student", "assessment", "attendance_session", "attendance_record", "nfc_card", "membership", "portal_config", "institution_settings", "notice", "fee_payment", "support_grant", "institution"];

export default async function AuditPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "audit.view");
  const filter = { entityType: one(sp.type), q: one(sp.q), page: Number(one(sp.page) ?? 1) };
  const rows = await auditLog(ctx, filter);
  const base = `/c/${slug}/admin/audit`;
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sensitive academic, administrative, card and permission changes in this college." />
      <Card padded={false}>
        <form className="flex flex-wrap gap-2 border-b border-line p-4" role="search">
          <Input name="q" defaultValue={filter.q} placeholder="Search summaries" className="max-w-xs" aria-label="Search" />
          <Select name="type" defaultValue={filter.entityType ?? ""} placeholder="All record types" options={TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))} className="w-auto" aria-label="Type" />
          <button className="rounded-lg border border-line px-3 text-sm hover:bg-surface-2">Filter</button>
        </form>
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No entries" />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{r.summary}</span>
                  <span className="text-xs text-muted">{formatDateTime(r.createdAt)}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge>{r.action}</Badge> by {r.actorName ?? "system"}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between px-4 py-3">
          {filter.page > 1 ? <LinkButton href={qs(base, { ...filter, page: filter.page - 1 })}>Newer</LinkButton> : <span />}
          {rows.length === 50 && <LinkButton href={qs(base, { ...filter, page: filter.page + 1 })}>Older</LinkButton>}
        </div>
      </Card>
    </>
  );
}
