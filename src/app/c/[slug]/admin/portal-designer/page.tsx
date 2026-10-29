import { Alert, Badge, Card, Checkbox, Field, Flash, Input, LinkButton, PageHeader, Table, Tabs, Td, TenantFields, Textarea, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES, ROLE_LABELS, resolvePermissions } from "@/lib/permissions";
import { MODULES, PUBLIC_FIELDS, orderedModules } from "@/lib/portal-config";
import { flashOf, one, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { configHistory } from "@/server/services/settings";
import { listStructure } from "@/server/services/academics";
import { listStudents } from "@/server/services/students";
import { discardDraftAction, publishPortalAction, saveAcademicAction, savePermissionsAction, savePortalDraftAction } from "@/server/actions/admin";

export const metadata = { title: "Portal designer" };

const TABS = [
  { key: "modules", label: "Modules & branding" },
  { key: "roles", label: "Roles & permissions" },
  { key: "academic", label: "Academic rules" },
  { key: "history", label: "Change history" },
];

export default async function PortalDesigner({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug, "portal.configure");
  const tab = TABS.some((t) => t.key === one(sp.tab)) ? one(sp.tab)! : "modules";
  const base = `/c/${slug}/admin/portal-designer`;
  const back = `${base}?tab=${tab}`;
  const draft = ctx.draftConfig;
  const dirty = JSON.stringify(draft) !== JSON.stringify(ctx.portalConfig);
  const [structure, history, sample] = await Promise.all([listStructure(ctx), configHistory(ctx), listStudents(ctx, { status: "active", pageSize: 5 })]);
  const previewId = sample.rows[0]?.student.id;
  const licensed = new Set(ctx.institution.licensedModules);

  return (
    <>
      <PageHeader
        title="Student portal designer"
        description="Configure what students see after tapping their card and signing in. Changes take effect for students only when published."
        actions={
          <>
            {previewId && (
              <LinkButton href={`/c/${slug}/admin/preview/${previewId}`} target="_blank">
                Preview draft
              </LinkButton>
            )}
          </>
        }
      />
      <Flash searchParams={flashOf(sp)} />
      {dirty && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>You have unpublished draft changes.</span>
          <div className="flex gap-2">
            <form action={discardDraftAction}>
              <TenantFields slug={slug} back={back} />
              <SubmitButton variant="secondary" confirm="Discard the draft and revert to the published configuration?">
                Discard draft
              </SubmitButton>
            </form>
            <form action={publishPortalAction}>
              <TenantFields slug={slug} back={back} />
              <SubmitButton>Publish now</SubmitButton>
            </form>
          </div>
        </div>
      )}
      <Tabs tabs={TABS} active={tab} makeHref={(k) => `${base}?tab=${k}`} />

      {tab === "modules" && (
        <form action={savePortalDraftAction} encType="multipart/form-data" className="space-y-6">
          <TenantFields slug={slug} back={back} />
          <Card title="Modules" description="Disabled modules are blocked on the server — students cannot reach them by URL. Restrict a module to specific departments or programmes, or leave both empty for everyone." padded={false}>
            <Table>
              <thead>
                <tr>
                  <Th>Enabled</Th>
                  <Th>Order</Th>
                  <Th>Module</Th>
                  <Th>Departments</Th>
                  <Th>Programmes</Th>
                </tr>
              </thead>
              <tbody>
                {orderedModules(draft).map((key) => {
                  const m = MODULES.find((x) => x.key === key)!;
                  const cfg = draft.modules[key];
                  const allowed = licensed.has(key);
                  return (
                    <tr key={key}>
                      <Td>
                        <input type="checkbox" name={`mod_${key}_enabled`} defaultChecked={cfg.enabled} disabled={!allowed} aria-label={`Enable ${m.label}`} className="h-4 w-4 accent-[var(--brand)]" />
                      </Td>
                      <Td>
                        <Input type="number" name={`mod_${key}_order`} defaultValue={cfg.order} min={0} max={100} className="w-20" aria-label={`Order of ${m.label}`} />
                      </Td>
                      <Td>
                        <div className="font-medium">
                          {m.label} {!allowed && <Badge tone="amber">Not in subscription</Badge>}
                        </div>
                        <div className="text-xs text-muted">{m.description}</div>
                      </Td>
                      <Td>
                        <select name={`mod_${key}_dept`} multiple defaultValue={cfg.departmentIds} className="min-w-36 rounded-lg border border-line p-1 text-xs" aria-label={`${m.label} departments`}>
                          {structure.departments.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.code}
                            </option>
                          ))}
                        </select>
                      </Td>
                      <Td>
                        <select name={`mod_${key}_prog`} multiple defaultValue={cfg.programmeIds} className="min-w-36 rounded-lg border border-line p-1 text-xs" aria-label={`${m.label} programmes`}>
                          {structure.programmes.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.code}
                            </option>
                          ))}
                        </select>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Branding">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Primary colour">
                  <Input type="color" name="primaryColor" defaultValue={draft.branding.primaryColor} className="h-10 p-1" />
                </Field>
                <Field label="Accent colour">
                  <Input type="color" name="accentColor" defaultValue={draft.branding.accentColor} className="h-10 p-1" />
                </Field>
                <Field label="Welcome message" className="sm:col-span-2">
                  <Textarea name="welcomeMessage" rows={2} maxLength={280} defaultValue={draft.branding.welcomeMessage} />
                </Field>
                <Field label="College logo" hint="PNG, JPEG or WebP · max 2 MB" className="sm:col-span-2">
                  <div className="flex items-center gap-3">
                    {draft.branding.logoFileId && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/files/${draft.branding.logoFileId}`} alt="Current logo" className="h-10 w-10 rounded border border-line object-contain" />
                    )}
                    <Input type="file" name="logo" accept="image/png,image/jpeg,image/webp" />
                  </div>
                </Field>
              </div>
            </Card>
            <Card title="Public NFC tap page" description="Fields shown to anyone who taps or scans the card, without signing in. Keep this minimal.">
              <div className="grid grid-cols-2 gap-2">
                {PUBLIC_FIELDS.map((f) => (
                  <Checkbox key={f.key} name="publicFields" value={f.key} defaultChecked={draft.publicFields.includes(f.key)} label={f.label} />
                ))}
              </div>
              <div className="mt-4">
                <Alert tone="info">Attendance, marks, fees, contact details and documents are never shown on the public page, whatever is selected here.</Alert>
              </div>
            </Card>
          </div>

          <div className="flex justify-end gap-2">
            <SubmitButton variant="secondary" name="intent" value="draft">
              Save draft
            </SubmitButton>
            <SubmitButton name="intent" value="publish" confirm="Publish this configuration to all students now?">
              Save & publish
            </SubmitButton>
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

      {tab === "history" && (
        <Card padded={false}>
          <ul className="divide-y divide-line">
            {history.map((h) => (
              <li key={h.entry.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span>
                  <Badge tone={h.entry.action === "publish" ? "green" : h.entry.action === "discard" ? "red" : "gray"}>{h.entry.action.replace("_", " ")}</Badge> <span className="ml-1">{h.actor ?? "—"}</span>
                </span>
                <span className="text-xs text-muted">{formatDateTime(h.entry.createdAt)}</span>
              </li>
            ))}
            {!history.length && <li className="px-5 py-6 text-center text-sm text-muted">No configuration changes yet.</li>}
          </ul>
        </Card>
      )}
    </>
  );
}
