import { Alert, Badge, Card, Checkbox, Field, Flash, Input, LinkButton, PageHeader, Table, Tabs, Td, TenantFields, Textarea, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES, ROLE_LABELS, resolvePermissions } from "@/lib/permissions";
import { FEATURE_FLAGS, MODULES, PUBLIC_FIELDS, feature, orderedModules } from "@/lib/portal-config";
import { flashOf, one, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { listStudents } from "@/server/services/students";
import { saveAcademicAction, savePermissionsAction, savePublicFieldsAction } from "@/server/actions/admin";

export const metadata = { title: "Roles, rules & ID page" };

const TABS = [
  { key: "portal", label: "Student portal" },
  { key: "public", label: "NFC tap page" },
  { key: "roles", label: "Roles & permissions" },
  { key: "academic", label: "Academic rules" },
];

/**
 * College configuration. The student portal itself (sections, order, data visibility,
 * branding) is controlled by the MySmartCard super admin in the platform Portal Builder;
 * college admins see the current settings here read-only.
 */
export default async function ConfigurationPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "portal.configure");
  const tab = TABS.some((t) => t.key === one(sp.tab)) ? one(sp.tab)! : "portal";
  const base = `/c/${slug}/admin/configuration`;
  const back = `${base}?tab=${tab}`;
  const cfg = ctx.portalConfig;
  const sample = tab === "portal" ? await listStudents(ctx, { status: "active", pageSize: 1 }) : null;
  const previewId = sample?.rows[0]?.student.id;

  return (
    <>
      <PageHeader title="Roles, rules & ID page" description="Role permissions, academic rules and what the public NFC tap page shows." />
      <Flash searchParams={flashOf(sp)} />
      <Tabs tabs={TABS} active={tab} makeHref={(k) => `${base}?tab=${k}`} />

      {tab === "portal" && (
        <div className="space-y-6">
          <Alert tone="info">The student portal’s sections, their order, branding and which data students can see are managed by MySmartCard. Contact MySmartCard support to request a change. Every record stays available to administrators here regardless of what students see.</Alert>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Sections students see" actions={previewId && <LinkButton href={`/c/${slug}/admin/preview/${previewId}`} target="_blank">See as a student</LinkButton>} padded={false}>
              <ul className="divide-y divide-line">
                {orderedModules(cfg).map((k) => (
                  <li key={k} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span>{MODULES.find((m) => m.key === k)!.label}</span>
                    {cfg.modules[k].enabled ? <Badge tone="green">Visible</Badge> : <Badge tone="gray">Hidden</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Data visible to students" padded={false}>
              <ul className="divide-y divide-line">
                {FEATURE_FLAGS.map((f) => (
                  <li key={f.key} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span>
                      {f.label}
                      <span className="block text-xs text-muted">{f.description}</span>
                    </span>
                    {feature(cfg, f.key) ? <Badge tone="green">Shown</Badge> : <Badge tone="gray">Hidden</Badge>}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}

      {tab === "public" && (
        <form action={savePublicFieldsAction} className="max-w-3xl space-y-4">
          <TenantFields slug={slug} back={back} />
          <div className="space-y-6">
            <Card title="Public NFC tap page" description="Fields printed on the digital ID that anyone who taps or scans the card sees, without signing in.">
              <div className="grid grid-cols-2 gap-2">
                {PUBLIC_FIELDS.map((f) => (
                  <Checkbox key={f.key} name="publicFields" value={f.key} defaultChecked={cfg.publicFields.includes(f.key)} label={"personal" in f ? `${f.label} (personal)` : f.label} />
                ))}
              </div>
              <div className="mt-4">
                <Alert tone="info">Fields marked personal are visible to anyone holding the card, so enable them only with student consent (for example an emergency contact). Attendance, marks, fees and documents are never shown publicly. Students see them after signing in, and staff who tap a card while signed in get a link to the full record.</Alert>
              </div>
            </Card>
          </div>
          <div className="flex justify-end">
            <SubmitButton confirm="Update what anyone who taps a student card can see?">Save tap-page fields</SubmitButton>
          </div>
        </form>
      )}

      {tab === "roles" && (
        <form action={savePermissionsAction} className="space-y-4">
          <TenantFields slug={slug} back={back} />
          <Alert tone="info">Permissions are enforced on the server for every request. College administrators always keep full access; students have no staff permissions. Changes are audited.</Alert>
          {!ctx.perms.has("users.manage") && <Alert tone="warn">You can view but not change role permissions.</Alert>}
          <Card padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>Permission</Th>
                  {ROLES.filter((r) => r !== "college_admin" && r !== "student").map((r) => (
                    <Th key={r} className="text-center">
                      {ROLE_LABELS[r].split(" ")[0]}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(PERMISSIONS).map(([perm, label]) => (
                  <tr key={perm}>
                    <Td>
                      <div className="text-sm">{label}</div>
                      <div className="font-mono text-[11px] text-muted">{perm}</div>
                    </Td>
                    {ROLES.filter((r) => r !== "college_admin" && r !== "student").map((r) => {
                      const on = resolvePermissions(r, ctx.permissionOverrides).has(perm as never);
                      const isDefault = DEFAULT_ROLE_PERMISSIONS[r].includes(perm as never) === on;
                      return (
                        <Td key={r} className="text-center">
                          <input type="checkbox" name={`${r}:${perm}`} defaultChecked={on} aria-label={`${ROLE_LABELS[r]}: ${label}`} className={`h-4 w-4 accent-[var(--brand)] ${isDefault ? "" : "ring-2 ring-amber-400"}`} />
                        </Td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
          {ctx.perms.has("users.manage") && (
            <div className="flex justify-end">
              <SubmitButton confirm="Save role permission changes for your college?">Save permissions</SubmitButton>
            </div>
          )}
        </form>
      )}

      {tab === "academic" && (
        <form action={saveAcademicAction} className="space-y-6">
          <TenantFields slug={slug} back={back} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Attendance rules">
              <div className="space-y-4">
                <Field label="Minimum attendance (%)" hint="Students below this see a shortage warning.">
                  <Input type="number" name="attendanceThreshold" min={0} max={100} step="0.5" defaultValue={ctx.academic.attendanceThreshold} required />
                </Field>
                <Checkbox name="lateCountsAsPresent" defaultChecked={ctx.academic.lateCountsAsPresent} label="Count “late” as present" />
                <Checkbox name="excludeExcused" defaultChecked={ctx.academic.excludeExcused} label="Exclude excused sessions from the total" />
              </div>
            </Card>
            <Card title="Grading scale">
              <div className="space-y-4">
                <Field label="Pass percentage">
                  <Input type="number" name="passPercentage" min={0} max={100} defaultValue={ctx.academic.passPercentage} required />
                </Field>
                <Field label="Grade bands" hint="One per line: minimum%, grade, grade point. Must include a band starting at 0.">
                  <Textarea name="gradeScale" rows={8} className="font-mono" defaultValue={ctx.academic.gradeScale.map((g) => `${g.min}, ${g.grade}, ${g.point}`).join("\n")} />
                </Field>
              </div>
            </Card>
          </div>
          <div className="flex justify-end">
            <SubmitButton>Save academic rules</SubmitButton>
          </div>
        </form>
      )}

    </>
  );
}
