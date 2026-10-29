import type { AcademicSettings } from "./portal-config";

// ---------------------------------------------------------------- Attendance

export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["present", "absent", "late", "excused"];

export type AttendanceSummary = {
  conducted: number;
  attended: number;
  absent: number;
  excused: number;
  percentage: number | null;
  shortage: boolean;
  /** Classes the student must attend consecutively to reach the threshold (0 if already met). */
  classesNeeded: number;
};

export function summarizeAttendance(statuses: AttendanceStatus[], rules: AcademicSettings): AttendanceSummary {
  let attended = 0;
  let absent = 0;
  let excused = 0;
  for (const s of statuses) {
    if (s === "present" || (s === "late" && rules.lateCountsAsPresent)) attended++;
    else if (s === "excused") excused++;
    else absent++;
  }
  const conducted = rules.excludeExcused ? statuses.length - excused : statuses.length;
  const percentage = conducted > 0 ? round2((attended / conducted) * 100) : null;
  const t = rules.attendanceThreshold / 100;
  let classesNeeded = 0;
  if (percentage !== null && percentage < rules.attendanceThreshold && t < 1) {
    // (attended + x) / (conducted + x) >= t  =>  x >= (t*conducted - attended) / (1 - t)
    classesNeeded = Math.max(0, Math.ceil((t * conducted - attended) / (1 - t) - 1e-9));
  }
  return {
    conducted,
    attended,
    absent,
    excused,
    percentage,
    shortage: percentage !== null && percentage < rules.attendanceThreshold,
    classesNeeded,
  };
}

// ---------------------------------------------------------------- Grading

export function gradeFor(percentage: number, rules: AcademicSettings): { grade: string; point: number } {
  const scale = [...rules.gradeScale].sort((a, b) => b.min - a.min);
  const band = scale.find((b) => percentage >= b.min) ?? scale[scale.length - 1];
  return { grade: band.grade, point: band.point };
}

export type MarkRow = { subjectId: string; obtained: number | null; max: number; isAbsent: boolean };
export type SubjectInfo = { id: string; code: string; name: string; credits: number; semester: number };

export type SubjectResult = SubjectInfo & {
  obtained: number;
  max: number;
  percentage: number;
  grade: string;
  point: number;
  passed: boolean;
};

/** Aggregate published marks per subject. Absent counts as zero. */
export function computeSubjectResults(rows: MarkRow[], subjects: SubjectInfo[], rules: AcademicSettings): SubjectResult[] {
  const bySubject = new Map<string, { obtained: number; max: number }>();
  for (const r of rows) {
    const acc = bySubject.get(r.subjectId) ?? { obtained: 0, max: 0 };
    acc.obtained += r.isAbsent ? 0 : (r.obtained ?? 0);
    acc.max += r.max;
    bySubject.set(r.subjectId, acc);
  }
  const out: SubjectResult[] = [];
  for (const s of subjects) {
    const acc = bySubject.get(s.id);
    if (!acc || acc.max <= 0) continue;
    const percentage = round2((acc.obtained / acc.max) * 100);
    const { grade, point } = gradeFor(percentage, rules);
    out.push({ ...s, obtained: round2(acc.obtained), max: acc.max, percentage, grade, point, passed: percentage >= rules.passPercentage });
  }
  return out;
}

/** Credit-weighted grade point average. Returns null when no credits. */
export function gpa(results: Pick<SubjectResult, "credits" | "point">[]): number | null {
  const credits = results.reduce((s, r) => s + r.credits, 0);
  if (!credits) return null;
  return round2(results.reduce((s, r) => s + r.credits * r.point, 0) / credits);
}

export function semesterSummary(results: SubjectResult[]) {
  const bySem = new Map<number, SubjectResult[]>();
  for (const r of results) bySem.set(r.semester, [...(bySem.get(r.semester) ?? []), r]);
  const semesters = [...bySem.entries()]
    .sort(([a], [b]) => a - b)
    .map(([semester, rs]) => ({ semester, sgpa: gpa(rs), credits: rs.reduce((s, r) => s + r.credits, 0), subjects: rs }));
  return { semesters, cgpa: gpa(results) };
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------- Assessment workflow

export const ASSESSMENT_CATEGORIES = [
  { key: "internal", label: "Internal examination", group: "exam" },
  { key: "midterm", label: "Midterm examination", group: "exam" },
  { key: "end_semester", label: "End-semester examination", group: "exam" },
  { key: "practical", label: "Laboratory practical", group: "internal" },
  { key: "viva", label: "Viva", group: "internal" },
  { key: "class_test", label: "Class test", group: "internal" },
  { key: "assignment", label: "Assignment", group: "internal" },
  { key: "project", label: "Project", group: "internal" },
] as const;
export type AssessmentCategory = (typeof ASSESSMENT_CATEGORIES)[number]["key"];

export type AssessmentStatus = "draft" | "submitted" | "approved" | "published";
const TRANSITIONS: Record<AssessmentStatus, AssessmentStatus[]> = {
  draft: ["submitted"],
  submitted: ["approved", "draft"],
  approved: ["published", "draft"],
  published: ["draft"], // reopen for correction
};
export function canTransition(from: AssessmentStatus, to: AssessmentStatus) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
