import Link from "next/link";
import { Card, EmptyState, Input, PageHeader, Tabs } from "@/components/ui";
import { one, type Props } from "@/lib/page";
import { orNotFound, requireSuperAdmin } from "@/server/session";
import { platformPreviewContext } from "@/server/services/portal-preview";
import { listStudents } from "@/server/services/students";

export const metadata = { title: "Preview student portal" };

/** Pick the student and the draft layer to preview. Previewing a real student is audited. */
export default async function PreviewPicker({ params, searchParams }: Props<{ collegeId: string }>) {
  const { collegeId } = await params;
  const sp = await searchParams;
  const user = await requireSuperAdmin();
  const layer = one(sp.layer) === "global" ? "global" : "college";
  const { ctx } = await orNotFound(platformPreviewContext(user, collegeId, layer));
  const q = one(sp.q);
  const list = await listStudents(ctx, { status: "active", q, pageSize: 20 });
  return (
    <>
      <PageHeader title={`Preview — ${ctx.institution.name}`} description="Choose a student to see the portal exactly as they would. Each preview is recorded in the college's audit log." back={{ href: `/platform/portal?college=${collegeId}`, label: "Portal Builder" }} />
      <Tabs
        tabs={[
          { key: "college", label: "This college's draft" },
          { key: "global", label: "Draft global defaults" },
        ]}
        active={layer}
        makeHref={(k) => `/platform/portal/preview/${collegeId}?layer=${k}`}
      />
      <form className="mb-4 max-w-md" role="search">
        <input type="hidden" name="layer" value={layer} />
        <Input name="q" defaultValue={q} placeholder="Search by name or enrollment number" aria-label="Search students" />
      </form>
      <Card padded={false}>
        {list.rows.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No active students found" />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {list.rows.map((r) => (
              <li key={r.student.id}>
                <Link href={`/platform/portal/preview/${collegeId}/${layer}/${r.student.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-surface-2">
                  <span>
                    <span className="font-medium">{r.student.fullName}</span> <span className="font-mono text-xs text-muted">{r.student.enrollmentNo}</span>
                  </span>
                  <span className="text-xs font-medium text-brand">Preview →</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
