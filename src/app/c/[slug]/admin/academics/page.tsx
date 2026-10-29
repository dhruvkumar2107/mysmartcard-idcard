import { Badge, Card, EmptyState, Field, Flash, Input, PageHeader, Select, Table, Td, TenantFields, Th } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { flashOf, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { listClassAssignments, listStructure, sectionLabel } from "@/server/services/academics";
import { listFaculty } from "@/server/services/people";
import { assignClassAction, createDepartmentAction, createProgrammeAction, createSectionAction, createSubjectAction, unassignClassAction } from "@/server/actions/admin";

export const metadata = { title: "Academic structure" };

export default async function AcademicsPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  const ctx = await requireTenant(slug, "academics.manage");
  const [s, classes, fac] = await Promise.all([listStructure(ctx), listClassAssignments(ctx), listFaculty(ctx)]);
  const back = `/c/${slug}/admin/academics`;
  const depOpts = s.departments.map((d) => ({ value: d.id, label: `${d.code} – ${d.name}` }));
  const progOpts = s.programmes.map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` }));
  const depCode = new Map(s.departments.map((d) => [d.id, d.code]));

  return (
    <>
      <PageHeader title="Academic structure" description="Departments → programmes → sections, subjects and teaching assignments. Teaching assignments decide which classes each faculty member can mark." />
      <Flash searchParams={flashOf(await searchParams)} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Departments" padded={false}>
          <form action={createDepartmentAction} className="flex flex-wrap gap-2 border-b border-line p-4">
            <TenantFields slug={slug} back={back} />
            <Input name="code" placeholder="Code (CSE)" required className="w-28 uppercase" aria-label="Department code" />
            <Input name="name" placeholder="Department name" required className="min-w-40 flex-1" aria-label="Department name" />
            <SubmitButton variant="secondary">Add</SubmitButton>
          </form>
          <ul className="divide-y divide-line text-sm">
            {s.departments.map((d) => (
              <li key={d.id} className="px-4 py-2.5">
                <span className="font-mono font-medium">{d.code}</span> · {d.name}
              </li>
            ))}
            {!s.departments.length && <li className="px-4 py-6 text-center text-muted">No departments yet.</li>}
          </ul>
        </Card>

        <Card title="Programmes" padded={false}>
          <form action={createProgrammeAction} className="grid gap-2 border-b border-line p-4 sm:grid-cols-2">
            <TenantFields slug={slug} back={back} />
            <Select name="departmentId" required placeholder="Department" options={depOpts} aria-label="Department" />
            <Input name="code" placeholder="Code (BTECH-CSE)" required className="uppercase" aria-label="Programme code" />
            <Input name="name" placeholder="Programme name" required aria-label="Programme name" />
            <div className="flex gap-2">
              <Input name="durationSemesters" type="number" min={1} max={12} defaultValue={8} required aria-label="Semesters" className="w-24" />
              <SubmitButton variant="secondary">Add</SubmitButton>
            </div>
          </form>
          <ul className="divide-y divide-line text-sm">
            {s.programmes.map((p) => (
              <li key={p.id} className="flex justify-between px-4 py-2.5">
                <span>
                  <span className="font-mono font-medium">{p.code}</span> · {p.name}
                </span>
                <span className="text-muted">
                  {depCode.get(p.departmentId)} · {p.durationSemesters} sem
                </span>
              </li>
            ))}
            {!s.programmes.length && <li className="px-4 py-6 text-center text-muted">No programmes yet.</li>}
          </ul>
        </Card>

        <Card title="Sections" padded={false}>
          <form action={createSectionAction} className="grid gap-2 border-b border-line p-4 sm:grid-cols-4">
            <TenantFields slug={slug} back={back} />
            <Select name="programmeId" required placeholder="Programme" options={progOpts} aria-label="Programme" className="sm:col-span-2" />
            <Input name="semester" type="number" min={1} max={12} placeholder="Sem" required aria-label="Semester" />
            <Input name="name" placeholder="A" required maxLength={10} aria-label="Section name" />
            <Input name="academicYear" placeholder="2026-27" defaultValue="2026-27" pattern="\d{4}-\d{2}" required aria-label="Academic year" className="sm:col-span-2" />
            <SubmitButton variant="secondary">Add section</SubmitButton>
          </form>
          <ul className="divide-y divide-line text-sm">
            {s.sections.map((x) => (
              <li key={x.section.id} className="flex justify-between px-4 py-2.5">
                <span>{sectionLabel(x)}</span>
                <Badge>{x.studentCount} students</Badge>
              </li>
            ))}
            {!s.sections.length && <li className="px-4 py-6 text-center text-muted">No sections yet.</li>}
          </ul>
        </Card>

        <Card title="Subjects / courses" padded={false}>
          <form action={createSubjectAction} className="grid gap-2 border-b border-line p-4 sm:grid-cols-3">
            <TenantFields slug={slug} back={back} />
            <Select name="departmentId" required placeholder="Department" options={depOpts} aria-label="Department" />
            <Select name="programmeId" placeholder="Programme (optional)" options={progOpts} aria-label="Programme" />
            <Input name="semester" type="number" min={1} max={12} placeholder="Semester" required aria-label="Semester" />
            <Input name="code" placeholder="Code (CS301)" required className="uppercase" aria-label="Subject code" />
            <Input name="name" placeholder="Subject name" required aria-label="Subject name" className="sm:col-span-2" />
            <Input name="credits" type="number" min={0} max={30} defaultValue={3} required aria-label="Credits" />
            <Select name="kind" options={[{ value: "theory", label: "Theory" }, { value: "lab", label: "Laboratory" }]} aria-label="Type" />
            <SubmitButton variant="secondary">Add subject</SubmitButton>
          </form>
          <ul className="max-h-80 divide-y divide-line overflow-y-auto text-sm">
            {s.subjects.map((x) => (
              <li key={x.id} className="flex justify-between px-4 py-2.5">
                <span>
                  <span className="font-mono font-medium">{x.code}</span> · {x.name} {x.kind === "lab" && <Badge tone="blue">Lab</Badge>}
                </span>
                <span className="text-muted">
                  Sem {x.semester} · {x.credits} cr
                </span>
              </li>
            ))}
            {!s.subjects.length && <li className="px-4 py-6 text-center text-muted">No subjects yet.</li>}
          </ul>
        </Card>
      </div>

      <Card title="Teaching assignments" className="mt-6" padded={false}>
        <form action={assignClassAction} className="grid gap-2 border-b border-line p-4 sm:grid-cols-4">
          <TenantFields slug={slug} back={back} />
          <Field label="Faculty">
            <Select name="facultyId" required placeholder="Choose" options={fac.map((f) => ({ value: f.faculty.id, label: `${f.faculty.name} (${f.faculty.employeeCode})` }))} />
          </Field>
          <Field label="Subject">
            <Select name="subjectId" required placeholder="Choose" options={s.subjects.map((x) => ({ value: x.id, label: `${x.code} – ${x.name}` }))} />
          </Field>
          <Field label="Section">
            <Select name="sectionId" required placeholder="Choose" options={s.sections.map((x) => ({ value: x.section.id, label: sectionLabel(x) }))} />
          </Field>
          <div className="flex items-end">
            <SubmitButton variant="secondary">Assign</SubmitButton>
          </div>
        </form>
        {classes.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No teaching assignments yet" />
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Faculty</Th>
                <Th>Subject</Th>
                <Th>Section</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.id}>
                  <Td>{c.facultyName}</Td>
                  <Td>
                    <span className="font-mono">{c.subjectCode}</span> {c.subjectName}
                  </Td>
                  <Td>
                    {c.programmeCode} · Sem {c.semester}-{c.sectionName} ({c.academicYear})
                  </Td>
                  <Td className="text-right">
                    <form action={unassignClassAction}>
                      <TenantFields slug={slug} back={back} />
                      <input type="hidden" name="id" value={c.id} />
                      <SubmitButton variant="ghost" className="text-danger" confirm="Remove this teaching assignment? Existing attendance and marks are kept.">
                        Remove
                      </SubmitButton>
                    </form>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
