import { z } from "zod";

export const MODULES = [
  { key: "digital_id", label: "Digital ID", description: "Photo, name, enrollment and card status" },
  { key: "results", label: "Examination Results", description: "Published internal, midterm and end-semester results" },
  { key: "internal_marks", label: "Practical & Internal Marks", description: "Labs, viva, class tests, projects" },
  { key: "timetable", label: "Timetable", description: "Uploaded timetable images, holidays and exam schedule" },
  { key: "notices", label: "Notice Board", description: "Announcements and circulars" },
  { key: "coursework", label: "Assignments & Materials", description: "Assignment images and study material" },
  { key: "library", label: "Library", description: "Issued books, due dates and fines" },
  { key: "attendance", label: "Attendance", description: "Overall and subject-wise attendance" },
  { key: "fees", label: "Fee Status & Receipts", description: "Dues, payments and receipts" },
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
  { key: "section", label: "Section" },
  { key: "admissionYear", label: "Admission year" },
  { key: "gender", label: "Gender" },
  { key: "dateOfBirth", label: "Date of birth", personal: true },
  { key: "email", label: "Student email", personal: true },
  { key: "phone", label: "Student phone", personal: true },
  { key: "guardianName", label: "Guardian name", personal: true },
  { key: "guardianPhone", label: "Emergency contact (guardian phone)", personal: true },
  { key: "address", label: "Address", personal: true },
] as const;

/** Extra rows shown under the ID card on the tap page, in this order. */
export const PUBLIC_DETAIL_FIELDS = ["section", "admissionYear", "gender", "dateOfBirth", "email", "phone", "guardianName", "guardianPhone", "address"] as const;
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
  /** Resolved super-admin data flags. Never trusted from storage: applyPolicy() always overwrites them. */
  features: z.record(z.string(), z.boolean()).optional(),
});
export type PortalConfig = z.infer<typeof portalConfigSchema>;
export type Branding = PortalConfig["branding"];

export function defaultPortalConfig(licensed: string[] = MODULE_KEYS): PortalConfig {
  return {
    branding: { primaryColor: "#1e3a8a", accentColor: "#0ea5e9", welcomeMessage: "Welcome to your campus portal.", logoFileId: null },
    modules: Object.fromEntries(
      MODULE_KEYS.map((key, i) => [key, { enabled: licensed.includes(key), order: i, departmentIds: [], programmeIds: [] }]),
    ),
    publicFields: ["photo", "fullName", "enrollmentNo", "department", "programme", "status", "cardValidity"],
    features: allFlags(false),
  };
}

// ---------------------------------------------------------------- Super-admin portal policy

/**
 * Data the student portal hides unless the MySmartCard super admin turns it on.
 * Each flag is enforced in the server-side portal loaders, not only in the UI.
 */
export const FEATURE_FLAGS = [
  { key: "showAttendance", label: "Attendance", description: "Attendance summary, percentages, subject-wise attendance and history" },
  { key: "showCGPA", label: "CGPA / SGPA", description: "CGPA and SGPA values (exam results stay visible either way)" },
  { key: "showFeeBalance", label: "Fee balance", description: "Fee section: payable, paid and outstanding amounts, payment history" },
  { key: "showFeeDueReminders", label: "Fee due dates & reminders", description: "Due dates and overdue reminders inside the fee section" },
  { key: "showAssignmentDeadlines", label: "Assignment deadlines", description: "Due dates, overdue labels and due-count tiles for assignments" },
  { key: "showTransport", label: "Transport", description: "Bus route, stop, pickup and drop timings" },
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number]["key"];
export const FLAG_KEYS = FEATURE_FLAGS.map((f) => f.key) as FeatureFlag[];
export type Features = Record<FeatureFlag, boolean>;

export function allFlags(v: boolean): Features {
  return Object.fromEntries(FLAG_KEYS.map((k) => [k, v])) as Features;
}

/** Modules whose visibility IS a data flag (no separate module toggle). */
export const FLAG_MODULES: Partial<Record<ModuleKey, FeatureFlag>> = { attendance: "showAttendance", fees: "showFeeBalance", transport: "showTransport" };

/**
 * A policy layer. Global defaults are a complete policy; a college override holds
 * only the keys the super admin explicitly set, so changing a global default never
 * overwrites an explicit college choice.
 */
export const portalPolicySchema = z.object({
  modules: z.record(z.string(), z.object({ enabled: z.boolean().optional(), order: z.number().int().min(0).max(100).optional() })).default({}),
  features: z.record(z.string(), z.boolean()).default({}),
});
export type PortalPolicy = z.infer<typeof portalPolicySchema>;
export type ResolvedPolicy = { modules: Record<ModuleKey, { enabled: boolean; order: number }>; features: Features };

export function builtinDefaultPolicy(): ResolvedPolicy {
  return {
    modules: Object.fromEntries(MODULE_KEYS.map((k, i) => [k, { enabled: true, order: i }])) as ResolvedPolicy["modules"],
    features: allFlags(false),
  };
}

/** Parse a stored policy layer, dropping unknown keys. */
export function normalizePolicy(raw: unknown): PortalPolicy {
  const parsed = portalPolicySchema.safeParse(raw ?? {});
  if (!parsed.success) return { modules: {}, features: {} };
  const out: PortalPolicy = { modules: {}, features: {} };
  for (const k of MODULE_KEYS) {
    const m = parsed.data.modules[k];
    if (m && (m.enabled !== undefined || m.order !== undefined)) out.modules[k] = { ...(m.enabled !== undefined && { enabled: m.enabled }), ...(m.order !== undefined && { order: m.order }) };
  }
  for (const f of FLAG_KEYS) if (typeof parsed.data.features[f] === "boolean") out.features[f] = parsed.data.features[f];
  return out;
}

/** Layer policies left to right: built-in defaults, then global defaults, then the college override. */
export function resolvePolicy(...layers: PortalPolicy[]): ResolvedPolicy {
  const r = builtinDefaultPolicy();
  for (const layer of layers) {
    for (const k of MODULE_KEYS) {
      const m = layer.modules[k];
      if (m?.enabled !== undefined) r.modules[k].enabled = m.enabled;
      if (m?.order !== undefined) r.modules[k].order = m.order;
    }
    for (const f of FLAG_KEYS) if (layer.features[f] !== undefined) r.features[f] = layer.features[f]!;
  }
  for (const [k, flag] of Object.entries(FLAG_MODULES)) r.modules[k as ModuleKey].enabled = r.features[flag];
  return r;
}

/** The effective student-portal configuration: college branding/restrictions + super-admin policy + subscription. */
export function applyPolicy(cfg: PortalConfig, policy: ResolvedPolicy, licensed: string[]): PortalConfig {
  const modules = { ...cfg.modules };
  for (const k of MODULE_KEYS) {
    const base = modules[k] ?? { enabled: true, order: 0, departmentIds: [], programmeIds: [] };
    modules[k] = { ...base, enabled: policy.modules[k].enabled && licensed.includes(k), order: policy.modules[k].order };
  }
  return { ...cfg, modules, features: { ...policy.features } };
}

export function feature(cfg: PortalConfig, f: FeatureFlag): boolean {
  return cfg.features?.[f] === true;
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
  // Flags only ever come from the super-admin policy (applyPolicy); stored values are ignored.
  cfg.features = allFlags(false);
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
