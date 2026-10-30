import Link from "next/link";
import { Eye, Globe2, School } from "lucide-react";
import { Alert, Badge, Card, Field, Flash, Input, PageHeader, Tabs, Textarea, cn } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { FEATURE_FLAGS, FLAG_MODULES, MODULES, type ModuleKey, type PortalPolicy, type ResolvedPolicy } from "@/lib/portal-config";
import { formatDateTime } from "@/lib/format";
import { flashOf, one, type Props } from "@/lib/page";
import { requireSuperAdmin } from "@/server/session";
import { listInstitutions } from "@/server/services/platform";
import { collegePolicyState, globalPolicyState, overrideCounts, policyHistory } from "@/server/services/portal-builder";
import { discardPortalPolicyAction, publishPortalPolicyAction, rollbackPortalPolicyAction, savePortalPolicyAction } from "@/server/actions/platform";
import { isUuid } from "@/server/services/guard";

export const metadata = { title: "Portal Builder" };

const TABS = [
  { key: "visibility", label: "Sections & data" },
  { key: "branding", label: "Branding" },
  { key: "history", label: "Version history" },
];
const sectionModules = MODULES.filter((m) => !FLAG_MODULES[m.key]);
const select = "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm focus:border-accent focus:outline-none";

export default async function PortalBuilder({ searchParams }: Props) {
  const user = await requireSuperAdmin();
  const sp = await searchParams;
  const collegeParam = one(sp.college);
  const collegeId = collegeParam && isUuid(collegeParam) ? collegeParam : null;
  const tabs = collegeId ? TABS : TABS.filter((t) => t.key !== "branding");
  const tab = tabs.some((t) => t.key === one(sp.tab)) ? one(sp.tab)! : "visibility";
  const [colleges, history, counts] = await Promise.all([listInstitutions(user), policyHistory(user, collegeId), overrideCounts(user)]);
  const college = collegeId ? await collegePolicyState(user, collegeId) : null;
  const global = collegeId ? null : await globalPolicyState(user);
  const base = `/platform/portal?college=${collegeId ?? "global"}`;
  const back = `${base}&tab=${tab}`;
  const draft: PortalPolicy = college ? college.draft : global!.draft;
  const resolved: ResolvedPolicy = college ? college.resolvedDraft : global!.resolvedDraft;
  const published: ResolvedPolicy = college ? college.resolvedPublished : global!.resolvedPublished;
  const defaults = college?.defaults;
  const dirty = college ? college.dirty : global!.dirty;
  const hidden = (
    <>
      <input type="hidden" name="_back" value={back} />
      <input type="hidden" name="college" value={collegeId ?? "global"} />
      <input type="hidden" name="tab" value={tab} />
    </>
  );

  return (
    <>
      <PageHeader title="Student Portal Builder" description="Control what every college's students see. Global defaults apply to all colleges; a college override only changes the settings you explicitly set for it." />
      <Flash searchParams={flashOf(sp)} />

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Choose scope" className="space-y-1 lg:sticky lg:top-6 lg:self-start">
          <Link href="/platform/portal?college=global" className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", !collegeId ? "bg-brand text-white" : "hover:bg-surface-2")}>
            <Globe2 className="h-4 w-4" aria-hidden /> Global defaults
          </Link>
          <div className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Colleges</div>
          {colleges.map((c) => (
            <Link key={c.inst.id} href={`/platform/portal?college=${c.inst.id}`} className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm", collegeId === c.inst.id ? "bg-brand text-white" : "hover:bg-surface-2")}>
              <School className="h-4 w-4 shrink-0" aria-hidden /> <span className="truncate">{c.inst.name}</span>
            </Link>
          ))}
        </nav>

        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">{college ? college.institution.name : "Global defaults (all colleges)"}</h2>
            {college?.publishedAt && <span className="text-xs text-muted">Last published {formatDateTime(college.publishedAt)}</span>}
            {college && (
              <Link href={`/platform/portal/preview/${college.institution.id}`} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2">
                <Eye className="h-4 w-4" aria-hidden /> Preview draft
              </Link>
            )}
          </div>
          {dirty && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span>There are unpublished draft changes. Students still see the published version.</span>
              <div className="flex gap-2">
                <form action={discardPortalPolicyAction}>
                  {hidden}
                  <SubmitButton variant="secondary" confirm="Discard the draft and revert to the published configuration?">
                    Discard draft
                  </SubmitButton>
                </form>
                <form action={publishPortalPolicyAction}>
                  {hidden}
                  <SubmitButton confirm={college ? `Publish to all students of ${college.institution.name}?` : "Publish these defaults to every college that has not overridden them?"}>Publish</SubmitButton>
                </form>
              </div>
            </div>
          )}
          <Tabs tabs={tabs} active={tab} makeHref={(k) => `${base}&tab=${k}`} />

          {tab === "visibility" && (
            <form action={savePortalPolicyAction} className="space-y-6">
              {hidden}
              {college && <Alert tone="info">“Use default” follows the global defaults, so a later global change applies here. Choosing Show or Hide overrides it for this college only.</Alert>}
              <Card title="Restricted data" description="Hidden by default. When hidden, the data is removed on the server — it is not in the page, its source or any response — and students cannot reach it by URL. Administrators always keep full access." padded={false}>
                <ul className="divide-y divide-line">
                  {FEATURE_FLAGS.map((f) => (
                    <Row key={f.key} label={f.label} description={f.description} badge={published.features[f.key] ? <Badge tone="green">Live: shown</Badge> : <Badge tone="gray">Live: hidden</Badge>} extra={!college && counts[f.key] ? `${counts[f.key]} college override(s)` : undefined}>
                      <TriSelect name={`flag_${f.key}`} label={f.label} college={!!college} explicit={draft.features[f.key]} effective={resolved.features[f.key]} fallback={defaults?.features[f.key]} />
                    </Row>
                  ))}
                </ul>
              </Card>
              <Card title="Portal sections & order" description="Sections appear in ascending order. Attendance, Fees and Transport follow their data switches above." padded={false}>
                <ul className="divide-y divide-line">
                  {[...sectionModules]
                    .sort((a, b) => resolved.modules[a.key].order - resolved.modules[b.key].order)
                    .map((m) => (
                      <Row key={m.key} label={m.label} description={m.description} badge={published.modules[m.key].enabled ? <Badge tone="green">Live: shown</Badge> : <Badge tone="gray">Live: hidden</Badge>} extra={!college && counts[`mod:${m.key}`] ? `${counts[`mod:${m.key}`]} college override(s)` : undefined}>
                        <div className="flex items-center gap-2">
                          <TriSelect name={`mod_${m.key}`} label={m.label} college={!!college} explicit={draft.modules[m.key]?.enabled} effective={resolved.modules[m.key].enabled} fallback={defaults?.modules[m.key].enabled} />
                          <OrderInput k={m.key} college={!!college} explicit={draft.modules[m.key]?.order} effective={resolved.modules[m.key].order} />
                        </div>
                      </Row>
                    ))}
                  {(Object.keys(FLAG_MODULES) as ModuleKey[]).map((k) => (
                    <Row key={k} label={MODULES.find((m) => m.key === k)!.label} description="Visibility follows its data switch" badge={published.modules[k].enabled ? <Badge tone="green">Live: shown</Badge> : <Badge tone="gray">Live: hidden</Badge>}>
                      <OrderInput k={k} college={!!college} explicit={draft.modules[k]?.order} effective={resolved.modules[k].order} />
                    </Row>
                  ))}
                </ul>
              </Card>
              <SaveBar college={!!college} />
            </form>
          )}

          {tab === "branding" && college && (
            <form action={savePortalPolicyAction} encType="multipart/form-data" className="space-y-6">
              {hidden}
              {/* Keep the current visibility draft untouched when saving branding. */}
              <PolicyHidden draft={draft} />
              <Card title="College branding" description="Colours, welcome message and logo shown in this college's student portal and digital ID.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Primary colour">
                    <Input type="color" name="primaryColor" defaultValue={college.branding.draft.primaryColor} className="h-10 p-1" />
                  </Field>
                  <Field label="Accent colour">
                    <Input type="color" name="accentColor" defaultValue={college.branding.draft.accentColor} className="h-10 p-1" />
                  </Field>
                  <Field label="Welcome message" className="sm:col-span-2">
                    <Textarea name="welcomeMessage" rows={2} maxLength={280} defaultValue={college.branding.draft.welcomeMessage} />
                  </Field>
                  <Field label="College logo" hint="PNG, JPEG or WebP · max 2 MB" className="sm:col-span-2">
                    <div className="flex items-center gap-3">
                      {college.branding.draft.logoFileId && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`/api/files/${college.branding.draft.logoFileId}`} alt="Current logo" className="h-12 w-12 rounded border border-line object-contain" />
                      )}
                      <Input type="file" name="logo" accept="image/png,image/jpeg,image/webp" />
                    </div>
                  </Field>
                </div>
              </Card>
              <SaveBar college />
            </form>
          )}

          {tab === "history" && (
            <Card padded={false} description="Every saved draft, publish, discard and rollback. Restoring a version publishes it immediately and is audited.">
              <ul className="divide-y divide-line">
                {history.map((h) => (
                  <li key={h.entry.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>
                      <Badge tone={h.entry.action === "publish" ? "green" : h.entry.action === "rollback" ? "violet" : h.entry.action === "discard" ? "red" : "gray"}>{h.entry.action.replace("_", " ")}</Badge> <span className="ml-1">{h.actor ?? "—"}</span>
                      <span className="block text-xs text-muted">{summarize(h.entry.policy as PortalPolicy)}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-muted">{formatDateTime(h.entry.createdAt)}</span>
                      {(h.entry.action === "publish" || h.entry.action === "rollback") && (
                        <form action={rollbackPortalPolicyAction}>
                          <input type="hidden" name="_back" value={back} />
                          <input type="hidden" name="historyId" value={h.entry.id} />
                          <SubmitButton variant="secondary" className="px-2.5 py-1 text-xs" confirm="Restore and publish this version now?">
                            Restore
                          </SubmitButton>
                        </form>
                      )}
                    </span>
                  </li>
                ))}
                {!history.length && <li className="px-5 py-6 text-center text-sm text-muted">No changes yet.</li>}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, description, badge, extra, children }: { label: string; description: string; badge: React.ReactNode; extra?: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {label} {badge}
        </div>
        <div className="text-xs text-muted">
          {description}
          {extra ? ` · ${extra}` : ""}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  );
}

/** Global: Show/Hide. College: Use default (current default shown) / Show / Hide. */
function TriSelect({ name, label, college, explicit, effective, fallback }: { name: string; label: string; college: boolean; explicit: boolean | undefined; effective: boolean; fallback?: boolean }) {
  const value = college ? (explicit === undefined ? "inherit" : explicit ? "on" : "off") : effective ? "on" : "off";
  return (
    <select name={name} defaultValue={value} aria-label={label} className={select}>
      {college && <option value="inherit">Use default ({fallback ? "shown" : "hidden"})</option>}
      <option value="on">Show</option>
      <option value="off">Hide</option>
    </select>
  );
}

function OrderInput({ k, college, explicit, effective }: { k: string; college: boolean; explicit: number | undefined; effective: number }) {
  return <input type="number" name={`order_${k}`} min={0} max={100} defaultValue={college ? (explicit ?? "") : effective} placeholder={String(effective)} aria-label={`Order of ${k}`} className={cn(select, "w-20")} title={college ? "Blank = use the default order" : undefined} />;
}

function PolicyHidden({ draft }: { draft: PortalPolicy }) {
  return (
    <>
      {Object.entries(draft.features).map(([f, v]) => (
        <input key={f} type="hidden" name={`flag_${f}`} value={v ? "on" : "off"} />
      ))}
      {Object.entries(draft.modules).map(([k, m]) => (
        <span key={k}>
          {m?.enabled !== undefined && <input type="hidden" name={`mod_${k}`} value={m.enabled ? "on" : "off"} />}
          {m?.order !== undefined && <input type="hidden" name={`order_${k}`} value={m.order} />}
        </span>
      ))}
    </>
  );
}

function SaveBar({ college }: { college: boolean }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <SubmitButton variant="secondary" name="intent" value="draft">
        Save draft
      </SubmitButton>
      <SubmitButton name="intent" value="publish" confirm={college ? "Save and publish to this college's students now?" : "Save and publish to every college that uses the defaults?"}>
        Save & publish
      </SubmitButton>
    </div>
  );
}

function summarize(p: PortalPolicy) {
  const flags = FEATURE_FLAGS.filter((f) => p.features?.[f.key] !== undefined).map((f) => `${f.label}: ${p.features[f.key] ? "on" : "off"}`);
  const mods = Object.entries(p.modules ?? {})
    .filter(([, m]) => m?.enabled !== undefined)
    .map(([k, m]) => `${MODULES.find((x) => x.key === k)?.label ?? k}: ${m!.enabled ? "shown" : "hidden"}`);
  return [...flags, ...mods].join(" · ") || "No explicit overrides";
}