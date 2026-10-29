import { Card, Field, Input, Select, Textarea, TenantFields } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import type { StudentRow } from "@/server/services/students";
import { STUDENT_STATUSES } from "@/server/services/students";
import type { listStructure } from "@/server/services/academics";
import { sectionLabel } from "@/server/services/academics";

export function StudentForm({
  slug,
  back,
  action,
  structure,
  student,
  canSensitive,
}: {
  slug: string;
  back: string;
  action: (fd: FormData) => Promise<void>;
  structure: Awaited<ReturnType<typeof listStructure>>;
  student?: Partial<StudentRow>;
  canSensitive: boolean;
}) {
  const s = student ?? {};
  return (
    <form action={action} className="space-y-6" encType="multipart/form-data">
      <TenantFields slug={slug} back={back} />
      {s.id && <input type="hidden" name="id" value={s.id} />}
      <Card title="Identity">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Official full name">
            <Input name="fullName" defaultValue={s.fullName ?? ""} required minLength={2} maxLength={120} />
          </Field>
          <Field label="Enrollment / registration no." hint="Unique within your college">
            <Input name="enrollmentNo" defaultValue={s.enrollmentNo ?? ""} required pattern="[A-Za-z0-9/_\-]+" maxLength={40} className="font-mono uppercase" />
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={s.status ?? "active"} options={STUDENT_STATUSES.map((x) => ({ value: x, label: x }))} />
          </Field>
          <Field label="Gender">
            <Select name="gender" defaultValue={s.gender ?? ""} placeholder="—" options={["Female", "Male", "Non-binary", "Prefer not to say"].map((x) => ({ value: x, label: x }))} />
          </Field>
          <Field label="Blood group">
            <Select name="bloodGroup" defaultValue={s.bloodGroup ?? ""} placeholder="—" options={["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((x) => ({ value: x, label: x }))} />
          </Field>
          {!s.id && (
            <Field label="Photograph" hint="JPEG, PNG or WebP · max 2 MB">
              <Input type="file" name="photo" accept="image/jpeg,image/png,image/webp" />
            </Field>
          )}
        </div>
      </Card>
      <Card title="Academic placement">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Department">
            <Select name="departmentId" defaultValue={s.departmentId ?? ""} placeholder="—" options={structure.departments.map((d) => ({ value: d.id, label: `${d.code} – ${d.name}` }))} />
          </Field>
          <Field label="Programme">
            <Select name="programmeId" defaultValue={s.programmeId ?? ""} placeholder="—" options={structure.programmes.map((p) => ({ value: p.id, label: `${p.code} – ${p.name}` }))} />
          </Field>
          <Field label="Section">
            <Select name="sectionId" defaultValue={s.sectionId ?? ""} placeholder="—" options={structure.sections.map((x) => ({ value: x.section.id, label: sectionLabel(x) }))} />
          </Field>
          <Field label="Semester">
            <Input name="semester" type="number" min={1} max={12} defaultValue={s.semester ?? 1} required />
          </Field>
          <Field label="Academic year" hint="e.g. 2026-27">
            <Input name="academicYear" defaultValue={s.academicYear ?? "2026-27"} pattern="\d{4}-\d{2}" required />
          </Field>
          <Field label="Admission year">
            <Input name="admissionYear" type="number" min={1990} max={2100} defaultValue={s.admissionYear ?? ""} />
          </Field>
        </div>
      </Card>
      <Card title="Contact" description={canSensitive ? undefined : "Some personal fields are restricted for your role and are not shown."}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Email" hint="Used for portal sign-in">
            <Input name="email" type="email" defaultValue={s.email ?? ""} />
          </Field>
          <Field label="Phone">
            <Input name="phone" type="tel" defaultValue={s.phone ?? ""} maxLength={20} />
          </Field>
          {canSensitive && (
            <>
              <Field label="Date of birth">
                <Input name="dateOfBirth" type="date" defaultValue={s.dateOfBirth ?? ""} />
              </Field>
              <Field label="Guardian name">
                <Input name="guardianName" defaultValue={s.guardianName ?? ""} />
              </Field>
              <Field label="Guardian phone">
                <Input name="guardianPhone" type="tel" defaultValue={s.guardianPhone ?? ""} maxLength={20} />
              </Field>
              <Field label="Address" className="sm:col-span-2 lg:col-span-3">
                <Textarea name="address" rows={2} defaultValue={s.address ?? ""} maxLength={500} />
              </Field>
            </>
          )}
        </div>
      </Card>
      <div className="flex justify-end">
        <SubmitButton>{s.id ? "Save changes" : "Create student"}</SubmitButton>
      </div>
    </form>
  );
}
