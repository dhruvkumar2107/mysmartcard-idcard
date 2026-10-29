import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, Card, Flash, LinkButton, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { flashOf, type Props } from "@/lib/page";
import { requireSuperAdmin } from "@/server/session";
import { activeSupportGrants, listInstitutions, platformStats } from "@/server/services/platform";

export const metadata = { title: "Platform" };

export default async function PlatformHome({ searchParams }: Props) {
  const user = await requireSuperAdmin();
  const [stats, rows, grants] = await Promise.all([platformStats(user), listInstitutions(user), activeSupportGrants(user)]);
  return (
    <>
      <PageHeader
        title="Platform administration"
        description="Colleges are fully isolated tenants. Platform staff see aggregate counts only; entering a college requires a support grant issued by that college."
        actions={
          <LinkButton href="/platform/colleges/new" variant="primary">
            <Plus className="h-4 w-4" aria-hidden /> Onboard college
          </LinkButton>
        }
      />
      <Flash searchParams={flashOf(await searchParams)} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Colleges" value={stats.institutions} hint={`${stats.activeInstitutions} active`} />
        <Stat label="Students" value={stats.students.toLocaleString("en-IN")} />
        <Stat label="User accounts" value={stats.users.toLocaleString("en-IN")} />
        <Stat label="Active NFC cards" value={stats.activeCards.toLocaleString("en-IN")} />
        <Stat
          label="Database / files"
          value={stats.dbOk && stats.storage.ok ? "Healthy" : "Problem"}
          tone={stats.dbOk && stats.storage.ok ? "ok" : "danger"}
          hint={`DB ${stats.dbOk ? "up" : "down"} · ${stats.storage.backend} ${stats.storage.ok ? "up" : `down${stats.storage.error ? ` (${stats.storage.error})` : ""}`}`}
        />
      </div>
      <Card className="mt-6" padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>College</Th>
              <Th>Plan</Th>
              <Th>Students</Th>
              <Th>Faculty</Th>
              <Th>Active cards</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.inst.id} className="hover:bg-surface-2/50">
                <Td>
                  <Link href={`/platform/colleges/${r.inst.id}`} className="font-medium hover:underline">
                    {r.inst.name}
                  </Link>
                  <div className="font-mono text-xs text-muted">/c/{r.inst.slug}</div>
                </Td>
                <Td>
                  <Badge tone="blue">{r.inst.plan}</Badge>
                </Td>
                <Td className="tabular-nums">
                  {r.studentCount} / {r.inst.studentLimit}
                </Td>
                <Td className="tabular-nums">{r.facultyCount}</Td>
                <Td className="tabular-nums">{r.activeCards}</Td>
                <Td>
                  <StatusBadge status={r.inst.status} />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card title="Active support grants" className="mt-6" padded={false}>
        {grants.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">No college has granted support access right now.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {grants.map((g) => (
              <li key={g.grant.id} className="flex items-center justify-between px-5 py-3">
                <span>
                  <span className="font-medium">{g.institution.name}</span> — {g.grant.reason}
                  <span className="block text-xs text-muted">until {formatDateTime(g.grant.expiresAt)}</span>
                </span>
                <LinkButton href={`/c/${g.institution.slug}/admin`}>Enter (read-only)</LinkButton>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
