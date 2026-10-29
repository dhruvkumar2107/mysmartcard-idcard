import { Card, Checkbox, Field, Flash, Input, PageHeader, TenantFields } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { IMPORT_COLUMNS } from "@/lib/student-import";
import { flashOf, type SlugProps } from "@/lib/page";
import { requireTenant } from "@/server/session";
import { importStudentsAction } from "@/server/actions/admin";

export const metadata = { title: "Import students" };

export default async function ImportPage({ params, searchParams }: SlugProps) {
  const { slug } = await params;
  await requireTenant(slug, "students.import");
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_COLUMNS.join(",") + "\nNITCSE25901,Asha Verma,asha@example.edu,+91 90000 00000,2006-04-12,Female,CSE,BTECH-CSE,3,A,2026-27,2025,R. Verma,+91 91111 11111,O+\n")}`;
  return (
    <>
      <PageHeader title="Import students" description="Upload a CSV or XLSX file. Validate first, then import." back={{ href: `/c/${slug}/admin/students`, label: "Students" }} />
      <Flash searchParams={flashOf(await searchParams)} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Upload file" className="lg:col-span-2">
          <form action={importStudentsAction} className="space-y-4" encType="multipart/form-data">
            <TenantFields slug={slug} back={`/c/${slug}/admin/students/import`} />
            <Field label="CSV or XLSX file" hint="Max 4 MB, 5,000 rows. First row must contain column headers.">
              <Input type="file" name="file" accept=".csv,.xlsx" required />
            </Field>
            <Checkbox name="dryRun" defaultChecked label="Validate only (do not import yet)" />
            <SubmitButton>Run</SubmitButton>
          </form>
        </Card>
        <Card title="Format">
          <p className="mb-3 text-sm text-muted">Departments and programmes are matched by code. Sections are matched by name within the programme, semester and academic year.</p>
          <ul className="mb-4 grid grid-cols-2 gap-1 font-mono text-xs">
            {IMPORT_COLUMNS.map((c) => (
              <li key={c} className={["enrollment_no", "full_name", "department_code", "programme_code", "semester", "academic_year"].includes(c) ? "font-semibold" : "text-muted"}>
                {c}
              </li>
            ))}
          </ul>
          <p className="mb-4 text-xs text-muted">Bold columns are required. Rows with an enrollment number that already exists, or that repeats within the file, are rejected and listed.</p>
          <a href={template} download="student-import-template.csv" className="text-sm font-medium text-brand hover:underline">
            Download template CSV
          </a>
        </Card>
      </div>
    </>
  );
}
