import { Badge, Card, EmptyState, Field, Flash, Input, PageHeader, Select, TenantFields } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { DAYS } from "@/lib/timetable";
import { formatDate } from "@/lib/format";
import { flashOf, one, qs, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { listStructure, sectionLabel } from "@/server/services/academics";
import { listFaculty } from "@/server/services/people";
import { timetableFor, upcomingEvents } from "@/server/services/timetable";
import { addEventAction, addTimetableAction, removeEventAction, removeTimetableAction } from "@/server/actions/admin";

export const metadata = { title: "Timetable" };

export default async function TimetablePage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenant(slug);
  const manage = ctx.perms.has("timetable.manage");
  const base = `/c/${slug}/admin/timetable`;
  const s = await listStructure(ctx);
  const mine = !manage && ctx.facultyId;
  const sectionId = one(sp.section) ?? (mine ? undefined : s.sections[0]?.section.id);
  const [slots, fac, events] = await Promise.all([
    mine ? timetableFor(ctx, { facultyId: ctx.facultyId! }) : timetableFor(ctx, { sectionIds: sectionId ? [sectionId] : [] }),
    manage ? listFaculty(ctx) : Promise.resolve([]),
    upcomingEvents(ctx, undefined, 30),
  ]);
  const here = qs(base, { section: sectionId });
  const days = [1, 2, 3, 4, 5, 6];

  return (
    <>
      <PageHeader title={mine ? "My teaching timetable" : "Timetable"} description={manage ? "Conflicts for teacher, room and section are checked automatically when adding a slot." : undefined} />
      <Flash searchParams={flashOf(sp)} />
      {!mine && (
        <form className="mb-4 flex gap-2">
          <Select name="section" defaultValue={sectionId ?? ""} options={s.sections.map((x) => ({ value: x.section.id, label: sectionLabel(x) }))} className="max-w-sm" aria-label="Section" />
          <button className="rounded-lg border border-line px-3 text-sm hover:bg-surface-2">Show</button>
        </form>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {days.map((d) => {
          const daySlots = slots.filter((x) => x.entry.dayOfWeek === d);
          return (
            <Card key={d} title={DAYS[d]} padded={false}>
              {daySlots.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">No classes</p>
              ) : (
                <ul className="divide-y divide-line">
                  {daySlots.map((x) => (
                    <li key={x.entry.id} className="flex items-start justify-between gap-2 px-5 py-2.5 text-sm">
                      <span>
                        <span className="tabular-nums text-muted">
                          {x.entry.startTime}–{x.entry.endTime}
                        </span>{" "}
                        <span className="font-medium">{x.subjectCode}</span> {x.subjectKind === "lab" && <Badge tone="blue">Lab</Badge>}
                        <span className="block text-xs text-muted">
                          {x.facultyName ?? "TBA"} · {x.entry.room}
                          {mine ? ` · Sem ${x.semester}-${x.sectionName}` : ""}
                        </span>
                      </span>
                      {manage && (
                        <form action={removeTimetableAction}>
                          <TenantFields slug={slug} back={here} />
                          <input type="hidden" name="id" value={x.entry.id} />
                          <SubmitButton variant="ghost" className="px-2 py-1 text-xs text-danger" confirm="Remove this slot?">
                            Remove
                          </SubmitButton>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {manage && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title="Add class slot">
            <form action={addTimetableAction} className="grid gap-3 sm:grid-cols-2">
              <TenantFields slug={slug} back={here} />
              <Field label="Section" className="sm:col-span-2">
                <Select name="sectionId" defaultValue={sectionId} required options={s.sections.map((x) => ({ value: x.section.id, label: sectionLabel(x) }))} />
              </Field>
              <Field label="Subject">
                <Select name="subjectId" required options={s.subjects.map((x) => ({ value: x.id, label: `${x.code} – ${x.name}` }))} />
              </Field>
              <Field label="Faculty">
                <Select name="facultyId" placeholder="TBA" options={fac.map((f) => ({ value: f.faculty.id, label: f.faculty.name }))} />
              </Field>
              <Field label="Day">
                <Select name="dayOfWeek" options={days.map((d) => ({ value: String(d), label: DAYS[d] }))} />
              </Field>
              <Field label="Room / lab">
                <Input name="room" required placeholder="CSE-101" />
              </Field>
              <Field label="Start">
                <Input type="time" name="startTime" required defaultValue="09:00" />
              </Field>
              <Field label="End">
                <Input type="time" name="endTime" required defaultValue="09:55" />
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton>Add slot</SubmitButton>
              </div>
            </form>
          </Card>
          <Card title="Holidays, schedule changes & deadlines" padded={false}>
            <form action={addEventAction} className="grid gap-3 border-b border-line p-4 sm:grid-cols-2">
              <TenantFields slug={slug} back={here} />
              <Field label="Title" className="sm:col-span-2">
                <Input name="title" required />
              </Field>
              <Field label="Type">
                <Select name="kind" options={[{ value: "holiday", label: "Holiday" }, { value: "schedule_change", label: "Schedule change" }, { value: "deadline", label: "Academic deadline" }, { value: "event", label: "Event" }]} />
              </Field>
              <Field label="Applies to">
                <Select name="sectionId" placeholder="Whole college" options={s.sections.map((x) => ({ value: x.section.id, label: sectionLabel(x) }))} />
              </Field>
              <Field label="From">
                <Input type="date" name="startDate" required />
              </Field>
              <Field label="To (optional)">
                <Input type="date" name="endDate" />
              </Field>
              <Field label="Details" className="sm:col-span-2">
                <Input name="description" />
              </Field>
              <div>
                <SubmitButton variant="secondary">Add</SubmitButton>
              </div>
            </form>
            {events.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No upcoming entries" />
              </div>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {events.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                    <span>
                      <span className="font-medium">{e.title}</span> <Badge tone={e.kind === "holiday" ? "violet" : "amber"}>{e.kind.replace("_", " ")}</Badge>
                      <span className="block text-xs text-muted">
                        {formatDate(e.startDate)}
                        {e.endDate ? ` – ${formatDate(e.endDate)}` : ""}
                      </span>
                    </span>
                    <form action={removeEventAction}>
                      <TenantFields slug={slug} back={here} />
                      <input type="hidden" name="id" value={e.id} />
                      <SubmitButton variant="ghost" className="px-2 py-1 text-xs text-danger">
                        Remove
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
