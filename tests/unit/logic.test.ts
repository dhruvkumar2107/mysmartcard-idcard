import { describe, expect, it } from "vitest";
import { canTransition, computeSubjectResults, gpa, gradeFor, semesterSummary, summarizeAttendance, type AttendanceStatus } from "@/lib/academics";
import { DEFAULT_ACADEMIC, defaultPortalConfig, moduleVisibleToStudent, normalizeConfig } from "@/lib/portal-config";
import { DEFAULT_ROLE_PERMISSIONS, resolvePermissions } from "@/lib/permissions";
import { findConflicts } from "@/lib/timetable";
import { parseCsv, sanitizeCell, sheetToRecords, validateImport } from "@/lib/student-import";
import { decrypt, encrypt, generateToken } from "@/lib/crypto";
import { fineFor } from "@/server/services/library";
import { noticeTargetsStudent } from "@/server/services/notices";

const rep = (s: AttendanceStatus, n: number) => Array<AttendanceStatus>(n).fill(s);

describe("attendance calculation", () => {
  it("computes percentage with late counted as present and excused excluded", () => {
    const r = summarizeAttendance([...rep("present", 6), ...rep("late", 1), ...rep("absent", 2), ...rep("excused", 1)], DEFAULT_ACADEMIC);
    expect(r.conducted).toBe(9);
    expect(r.attended).toBe(7);
    expect(r.percentage).toBe(77.78);
    expect(r.shortage).toBe(false);
  });

  it("respects college rules when late does not count and excused is included", () => {
    const rules = { ...DEFAULT_ACADEMIC, lateCountsAsPresent: false, excludeExcused: false };
    const r = summarizeAttendance([...rep("present", 6), ...rep("late", 1), ...rep("absent", 2), ...rep("excused", 1)], rules);
    expect(r.conducted).toBe(10);
    expect(r.attended).toBe(6);
    expect(r.percentage).toBe(60);
    expect(r.shortage).toBe(true);
  });

  it("computes classes needed to recover from a shortage", () => {
    const r = summarizeAttendance([...rep("present", 6), ...rep("absent", 4)], DEFAULT_ACADEMIC); // 60%
    // (6+x)/(10+x) >= 0.75 -> x >= 6
    expect(r.classesNeeded).toBe(6);
    const after = summarizeAttendance([...rep("present", 12), ...rep("absent", 4)], DEFAULT_ACADEMIC);
    expect(after.percentage).toBe(75);
    expect(after.shortage).toBe(false);
  });

  it("returns null percentage when no classes conducted", () => {
    expect(summarizeAttendance([], DEFAULT_ACADEMIC).percentage).toBeNull();
    expect(summarizeAttendance(rep("excused", 3), DEFAULT_ACADEMIC).percentage).toBeNull();
  });
});

describe("grading and CGPA", () => {
  it("maps percentages to grade bands", () => {
    expect(gradeFor(95, DEFAULT_ACADEMIC)).toEqual({ grade: "O", point: 10 });
    expect(gradeFor(80, DEFAULT_ACADEMIC)).toEqual({ grade: "A+", point: 9 });
    expect(gradeFor(39.99, DEFAULT_ACADEMIC)).toEqual({ grade: "F", point: 0 });
  });

  it("aggregates marks per subject, absent counts as zero, and weights GPA by credits", () => {
    const subjects = [
      { id: "s1", code: "CS1", name: "A", credits: 4, semester: 1 },
      { id: "s2", code: "CS2", name: "B", credits: 2, semester: 1 },
      { id: "s3", code: "CS3", name: "C", credits: 3, semester: 2 },
    ];
    const results = computeSubjectResults(
      [
        { subjectId: "s1", obtained: 45, max: 50, isAbsent: false },
        { subjectId: "s1", obtained: 45, max: 50, isAbsent: false }, // 90% -> O/10
        { subjectId: "s2", obtained: null, max: 50, isAbsent: true }, // 0% -> F/0
        { subjectId: "s3", obtained: 70, max: 100, isAbsent: false }, // 70% -> A/8
      ],
      subjects,
      DEFAULT_ACADEMIC,
    );
    expect(results.map((r) => [r.code, r.grade, r.passed])).toEqual([
      ["CS1", "O", true],
      ["CS2", "F", false],
      ["CS3", "A", true],
    ]);
    const summary = semesterSummary(results);
    expect(summary.semesters[0].sgpa).toBe(6.67); // (4*10 + 2*0) / 6
    expect(summary.semesters[1].sgpa).toBe(8);
    expect(summary.cgpa).toBe(7.11); // (40 + 0 + 24) / 9
    expect(gpa([])).toBeNull();
  });

  it("enforces the results workflow", () => {
    expect(canTransition("draft", "submitted")).toBe(true);
    expect(canTransition("draft", "published")).toBe(false);
    expect(canTransition("submitted", "published")).toBe(false);
    expect(canTransition("approved", "published")).toBe(true);
    expect(canTransition("published", "draft")).toBe(true);
  });
});

describe("timetable conflicts", () => {
  const existing = [{ id: "e1", dayOfWeek: 1, startTime: "09:00", endTime: "10:00", sectionId: "secA", facultyId: "f1", room: "R101" }];
  it("detects faculty, room and section double booking", () => {
    const c = findConflicts({ dayOfWeek: 1, startTime: "09:30", endTime: "10:30", sectionId: "secA", facultyId: "f1", room: "r101" }, existing);
    expect(c.map((x) => x.kind).sort()).toEqual(["faculty", "room", "section"]);
  });
  it("allows back-to-back and other-day slots", () => {
    expect(findConflicts({ dayOfWeek: 1, startTime: "10:00", endTime: "11:00", sectionId: "secA", facultyId: "f1", room: "R101" }, existing)).toEqual([]);
    expect(findConflicts({ dayOfWeek: 2, startTime: "09:00", endTime: "10:00", sectionId: "secA", facultyId: "f1", room: "R101" }, existing)).toEqual([]);
  });
  it("rejects inverted times", () => {
    expect(findConflicts({ dayOfWeek: 3, startTime: "11:00", endTime: "10:00", sectionId: "x", facultyId: null, room: "Z" }, [])).toHaveLength(1);
  });
});

describe("student import validation", () => {
  const csv = [
    "Enrollment No,Full Name,Email,Department Code,Programme Code,Semester,Academic Year",
    "A001,Asha Rao,asha@example.edu,CSE,BT,3,2026-27",
    "a001,Dup In File,,CSE,BT,3,2026-27",
    "A002,Existing Student,,CSE,BT,3,2026-27",
    "A003,,bad-email,CSE,BT,13,2026",
  ].join("\n");
  it("normalizes headers, flags duplicates (in-file and existing) and schema errors", () => {
    const rows = parseCsv(csv);
    expect(Object.keys(rows[0])).toContain("enrollment_no");
    const { valid, issues } = validateImport(rows, new Set(["A002"]));
    expect(valid.map((v) => v.enrollment_no)).toEqual(["A001"]);
    expect(issues.find((i) => i.row === 3)?.errors[0]).toMatch(/Duplicate of row 2/);
    expect(issues.find((i) => i.row === 4)?.errors[0]).toMatch(/already exists/);
    const bad = issues.find((i) => i.row === 5)!;
    expect(bad.errors.join(" ")).toMatch(/full_name/);
    expect(bad.errors.join(" ")).toMatch(/email/);
    expect(bad.errors.join(" ")).toMatch(/academic_year/);
  });
  it("converts XLSX sheets (with Date cells) to records", () => {
    const recs = sheetToRecords([["Enrollment_No", "Date of Birth"], ["X1", new Date("2006-04-12T00:00:00Z")], [null, ""]]);
    expect(recs).toEqual([{ enrollment_no: "X1", date_of_birth: "2006-04-12" }]);
  });
  it("neutralizes spreadsheet formula injection in exports", () => {
    expect(sanitizeCell("=HYPERLINK(\"x\")")).toBe("'=HYPERLINK(\"x\")");
    expect(sanitizeCell("+91 900")).toBe("'+91 900");
    expect(sanitizeCell("Asha")).toBe("Asha");
  });
});

describe("permissions", () => {
  it("faculty cannot see sensitive data or manage cards by default", () => {
    const p = resolvePermissions("faculty");
    expect(p.has("attendance.mark")).toBe(true);
    expect(p.has("students.view_sensitive")).toBe(false);
    expect(p.has("cards.manage")).toBe(false);
  });
  it("applies college overrides but never grants staff permissions to students or reduces admins", () => {
    const o = { faculty: { "notices.publish": true, "coursework.manage": false }, student: { "students.view": true }, college_admin: { "audit.view": false } };
    const f = resolvePermissions("faculty", o);
    expect(f.has("notices.publish")).toBe(true);
    expect(f.has("coursework.manage")).toBe(false);
    expect(resolvePermissions("student", o).size).toBe(0);
    expect(resolvePermissions("college_admin", o).has("audit.view")).toBe(true);
    expect(DEFAULT_ROLE_PERMISSIONS.student).toEqual([]);
  });
});

describe("portal configuration", () => {
  it("never enables an unlicensed module and gates by department/programme", () => {
    const cfg = normalizeConfig({ ...defaultPortalConfig(), modules: { ...defaultPortalConfig().modules, fees: { enabled: true, order: 0, departmentIds: [], programmeIds: [] } } }, ["attendance", "digital_id"]);
    expect(cfg.modules.fees.enabled).toBe(false);
    const dep = "11111111-1111-4111-8111-111111111111";
    cfg.modules.attendance.departmentIds = [dep];
    expect(moduleVisibleToStudent(cfg, "attendance", { departmentId: dep, programmeId: null })).toBe(true);
    expect(moduleVisibleToStudent(cfg, "attendance", { departmentId: "other", programmeId: null })).toBe(false);
    expect(moduleVisibleToStudent(cfg, "attendance", { departmentId: null, programmeId: null })).toBe(false);
  });
  it("falls back to defaults on malformed stored config", () => {
    expect(normalizeConfig({ junk: true }, ["attendance"]).modules.attendance.enabled).toBe(true);
  });
});

describe("notice audience targeting", () => {
  const s = { id: "st1", departmentId: "d1", programmeId: "p1", semester: 3, sectionId: "sec1" };
  it("combines filters with AND, explicit students always match", () => {
    expect(noticeTargetsStudent({ scope: "all" }, s)).toBe(true);
    expect(noticeTargetsStudent({ scope: "targeted", departmentIds: ["d1"], semesters: [3] }, s)).toBe(true);
    expect(noticeTargetsStudent({ scope: "targeted", departmentIds: ["d1"], semesters: [5] }, s)).toBe(false);
    expect(noticeTargetsStudent({ scope: "targeted", studentIds: ["st1"], departmentIds: ["d9"] }, s)).toBe(true);
    expect(noticeTargetsStudent({ scope: "targeted" }, s)).toBe(false);
  });
});

describe("crypto & misc", () => {
  it("generates high-entropy URL-safe tokens and round-trips encryption", () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(t);
    expect(decrypt(encrypt(t))).toBe(t);
    const [iv, tag, body] = encrypt(t).split(".");
    const flipped = (tag[0] === "A" ? "B" : "A") + tag.slice(1);
    expect(() => decrypt([iv, flipped, body].join("."))).toThrow();
  });
  it("computes library fines per overdue day", () => {
    expect(fineFor("2026-01-10", "2026-01-10")).toBe(0);
    expect(fineFor("2026-01-10", "2026-01-13")).toBe(600);
  });
});
