import { z } from "zod";

export const MODULES = [
  { key: "digital_id", label: "Digital ID", description: "Photo, name, enrollment and card status" },
  { key: "attendance", label: "Attendance", description: "Overall and subject-wise attendance" },
  { key: "results", label: "Examination Results", description: "Published internal, midterm and end-semester results" },
  { key: "internal_marks", label: "Practical & Internal Marks", description: "Labs, viva, class tests, projects" },
  { key: "timetable", label: "Timetable", description: "Weekly schedule, holidays and exam timetable" },
  { key: "notices", label: "Notice Board", description: "Announcements and circulars" },
  { key: "coursework", label: "Assignments & Materials", description: "Assignments, notes and submissions" },
  { key: "fees", label: "Fee Status & Receipts", description: "Dues, payments and receipts" },
  { key: "library", label: "Library", description: "Issued books, due dates and fines" },
  { key: "transport", label: "Transport", description: "Route, pickup point and timings" },
] as const;
export type ModuleKey = (typeof MODULES)[number]["key"];
export const MODULE_KEYS = MODULES.map((m) => m.key) as ModuleKey[];

/** Fields that may be shown on the public (unauthenticated) NFC tap page. */
export const PUBLIC_FIELDS = [
  { key: "photo", label: "Photograph" },
  { key: "fullName", label: "Full name" },
  { key: "enrollmentNo", label: "Enrollment number" },
  { key: "department", label: "Department" },
  { key: "programme", label: "Programme" },
  { key: "semester", label: "Semester" },
  { key: "academicYear", label: "Academic year" },
  { key: "status", label: "Student status" },
  { key: "cardValidity", label: "Card validity" },
  { key: "bloodGroup", label: "Blood group (emergency)" },
] as const;
export type PublicFieldKey = (typeof PUBLIC_FIELDS)[number]["key"];

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour like #1e3a8a");

export const portalConfigSchema = z.object({
  branding: z.object({
    primaryColor: hex,
    accentColor: hex,
    welcomeMessage: z.string().max(280),
    logoFileId: z.string().uuid().nullable(),
  }),
  modules: z.record(
    z.string(),
    z.object({
      enabled: z.boolean(),
      order: z.number().int().min(0).max(100),
      /** Empty arrays = visible to everyone. Otherwise restricted to these departments/programmes. */
      departmentIds: z.array(z.string().uuid()),
      programmeIds: z.array(z.string().uuid()),
    }),
  ),
  publicFields: z.array(z.string()),
});
export type PortalConfig = z.infer<typeof portalConfigSchema>;

export function defaultPortalConfig(licensed: string[] = MODULE_KEYS): PortalConfig {
  return {
    branding: { primaryColor: "#1e3a8a", accentColor: "#0ea5e9", welcomeMessage: "Welcome to your campus portal.", logoFileId: null },
    modules: Object.fromEntries(
      MODULE_KEYS.map((key, i) => [key, { enabled: licensed.includes(key), order: i, departmentIds: [], programmeIds: [] }]),
    ),
    publicFields: ["photo", "fullName", "enrollmentNo", "department", "programme", "status", "cardValidity"],
  };
}

/** Parse stored JSON defensively, filling any missing module keys. */
export function normalizeConfig(raw: unknown, licensed: string[]): PortalConfig {
  const base = defaultPortalConfig(licensed);
  const parsed = portalConfigSchema.safeParse(raw);
  if (!parsed.success) return base;
  const cfg = parsed.data;
  for (const key of MODULE_KEYS) {
    if (!cfg.modules[key]) cfg.modules[key] = base.modules[key];
    // A module the platform has not licensed can never be enabled, whatever the college saved.
    if (!licensed.includes(key)) cfg.modules[key].enabled = false;
  }
  cfg.publicFields = cfg.publicFields.filter((f) => PUBLIC_FIELDS.some((p) => p.key === f));
  return cfg;
}

/** Server-side gate used by every student-portal data loader. */
export function moduleVisibleToStudent(
  cfg: PortalConfig,
  key: ModuleKey,
  student: { departmentId: string | null; programmeId: string | null },
): boolean {
  const m = cfg.modules[key];
  if (!m?.enabled) return false;
  if (m.departmentIds.length && (!student.departmentId || !m.departmentIds.includes(student.departmentId))) return false;
  if (m.programmeIds.length && (!student.programmeId || !m.programmeIds.includes(student.programmeId))) return false;
  return true;
}

export function orderedModules(cfg: PortalConfig): ModuleKey[] {
  return [...MODULE_KEYS].sort((a, b) => (cfg.modules[a]?.order ?? 0) - (cfg.modules[b]?.order ?? 0));
}

// ---------------------------------------------------------------- Academic settings

export const academicSettingsSchema = z.object({
  attendanceThreshold: z.number().min(0).max(100),
  /** Whether "late" counts as present when computing percentage. */
  lateCountsAsPresent: z.boolean(),
  /** Whether "excused" sessions are removed from the denominator. */
  excludeExcused: z.boolean(),
  gradeScale: z
    .array(z.object({ min: z.number().min(0).max(100), grade: z.string().min(1).max(4), point: z.number().min(0).max(10) }))
    .min(1),
  passPercentage: z.number().min(0).max(100),
});
export type AcademicSettings = z.infer<typeof academicSettingsSchema>;

export const DEFAULT_ACADEMIC: AcademicSettings = {
  attendanceThreshold: 75,
  lateCountsAsPresent: true,
  excludeExcused: true,
  passPercentage: 40,
  gradeScale: [
    { min: 90, grade: "O", point: 10 },
    { min: 80, grade: "A+", point: 9 },
    { min: 70, grade: "A", point: 8 },
    { min: 60, grade: "B+", point: 7 },
    { min: 50, grade: "B", point: 6 },
    { min: 45, grade: "C", point: 5 },
    { min: 40, grade: "P", point: 4 },
    { min: 0, grade: "F", point: 0 },
  ],
};

export function normalizeAcademic(raw: unknown): AcademicSettings {
  const parsed = academicSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_ACADEMIC;
}
