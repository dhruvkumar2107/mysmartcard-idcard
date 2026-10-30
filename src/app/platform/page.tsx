import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge, Card, Flash, LinkButton, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { flashOf, type Props } from "@/lib/page";
import { requireSuperAdmin } from "@/server/session";
import { listInstitutions, platformStats } from "@/server/services/platform";

export const metadata = { title: "Platform" };

export default async function PlatformHome({ searchParams }: Props) {
  const user = await requireSuperAdmin();
  const [stats, rows] = await Promise.all([platformStats(user), listInstitutions(user)]);
  return (
    <>
      <PageHeader
        title="Platform administration"
        description="Colleges are isolated tenants. As super admin you can open any college workspace and configure every student portal; each access and change is recorded in that college’s audit log."
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
    </>
  );
}
