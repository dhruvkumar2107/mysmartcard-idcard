import Papa from "papaparse";
import { z } from "zod";

/** Columns accepted in CSV/XLSX imports. Department/programme/section are referenced by code/name. */
export const IMPORT_COLUMNS = [
  "enrollment_no",
  "full_name",
  "email",
  "phone",
  "date_of_birth",
  "gender",
  "department_code",
  "programme_code",
  "semester",
  "section",
  "academic_year",
  "admission_year",
  "guardian_name",
  "guardian_phone",
  "blood_group",
] as const;

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const importRowSchema = z.object({
  enrollment_no: z.string().trim().min(1, "enrollment_no is required").max(40).regex(/^[A-Za-z0-9/_-]+$/, "enrollment_no has invalid characters"),
  full_name: z.string().trim().min(2, "full_name is required").max(120),
  email: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v.toLowerCase()))
    .nullable()
    .optional()
    .refine((v) => !v || z.email().safeParse(v).success, "email is invalid"),
  phone: optionalText,
  date_of_birth: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), "date_of_birth must be YYYY-MM-DD"),
  gender: optionalText,
  department_code: z.string().trim().min(1, "department_code is required"),
  programme_code: z.string().trim().min(1, "programme_code is required"),
  semester: z.coerce.number().int().min(1).max(12),
  section: optionalText,
  academic_year: z.string().trim().regex(/^\d{4}-\d{2}$/, "academic_year must look like 2026-27"),
  admission_year: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(1990).max(2100).nullable()),
  guardian_name: optionalText,
  guardian_phone: optionalText,
  blood_group: optionalText,
});
export type ImportRow = z.infer<typeof importRowSchema>;

export type RowIssue = { row: number; enrollmentNo?: string; errors: string[] };

export function normalizeHeader(h: string) {
  return h.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function parseCsv(text: string): Record<string, string>[] {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });
  return res.data;
}

/** Convert a 2D sheet (first row = headers) into keyed records. */
export function sheetToRecords(sheet: unknown[][]): Record<string, string>[] {
  const [header, ...rows] = sheet;
  if (!header) return [];
  const keys = header.map((h) => normalizeHeader(String(h ?? "")));
  return rows
    .filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ""))
    .map((r) =>
      Object.fromEntries(
        keys.map((k, i) => {
          const v = r[i];
          const s = v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? "" : String(v);
          return [k, s];
        }),
      ),
    );
}

/**
 * Validate raw rows: schema checks, duplicates inside the file, and duplicates
 * against enrollment numbers that already exist for this college.
 */
export function validateImport(raw: Record<string, string>[], existingEnrollments: Set<string>) {
  const valid: (ImportRow & { row: number })[] = [];
  const issues: RowIssue[] = [];
  const seen = new Map<string, number>();
  raw.forEach((r, idx) => {
    const rowNo = idx + 2; // +1 header, +1 for 1-based
    const parsed = importRowSchema.safeParse(r);
    if (!parsed.success) {
      issues.push({ row: rowNo, enrollmentNo: r.enrollment_no, errors: parsed.error.issues.map((i) => i.message) });
      return;
    }
    const key = parsed.data.enrollment_no.toUpperCase();
    if (seen.has(key)) {
      issues.push({ row: rowNo, enrollmentNo: parsed.data.enrollment_no, errors: [`Duplicate of row ${seen.get(key)} in this file`] });
      return;
    }
    seen.set(key, rowNo);
    if (existingEnrollments.has(key)) {
      issues.push({ row: rowNo, enrollmentNo: parsed.data.enrollment_no, errors: ["Enrollment number already exists in this college"] });
      return;
    }
    valid.push({ ...parsed.data, row: rowNo });
  });
  return { valid, issues };
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return Papa.unparse({ fields: columns, data: rows.map((r) => columns.map((c) => sanitizeCell(r[c]))) });
}

/** Neutralize spreadsheet formula injection (=, +, -, @ at cell start). */
export function sanitizeCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
