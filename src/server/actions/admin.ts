"use server";

import { cookies } from "next/headers";
import { encrypt } from "@/lib/crypto";
import { badRequest } from "@/lib/errors";
import { parseRupeesToMinor } from "@/lib/format";
import { PUBLIC_FIELDS } from "@/lib/portal-config";
import { PERMISSIONS, ROLES } from "@/lib/permissions";
import { parseCsv, sheetToRecords } from "@/lib/student-import";
import { bool, int, list, optStr, str, tenantAction } from "../action";
import * as academics from "../services/academics";
import * as assessments from "../services/assessments";
import * as attendance from "../services/attendance";
import * as cards from "../services/cards";
import * as coursework from "../services/coursework";
import * as finance from "../services/finance";
import * as library from "../services/library";
import * as notices from "../services/notices";
import * as people from "../services/people";
import * as settings from "../services/settings";
import * as students from "../services/students";
import * as timetable from "../services/timetable";
import * as timetableImages from "../services/timetable-images";
import * as transport from "../services/transport";

/** One-time credentials are passed to the next page in a short-lived, encrypted, httpOnly cookie — never in the URL. */
async function stashCredential(slug: string, email: string, password: string | null) {
  const value = password ? `New account ${email} — one-time password: ${password}` : `${email} already had an account; they can sign in with their existing password.`;
  (await cookies()).set("msc_onetime", encrypt(value), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: `/c/${slug}`, maxAge: 300 });
}

const dateOrNull = (fd: FormData, k: string) => {
  const v = optStr(fd, k);
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`${k} is not a valid date`);
  return d;
};
const intOrNull = (fd: FormData, k: string) => (optStr(fd, k) ? int(fd, k) : null);

// ---------------------------------------------------------------- Academics

export async function createDepartmentAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const d = await academics.createDepartment(ctx, { code: str(fd, "code"), name: str(fd, "name") });
    return `Department ${d.code} created.`;
  });
}
export async function createProgrammeAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const p = await academics.createProgramme(ctx, { departmentId: str(fd, "departmentId"), code: str(fd, "code"), name: str(fd, "name"), durationSemesters: int(fd, "durationSemesters") });
    return `Programme ${p.code} created.`;
  });
}
export async function createSectionAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await academics.createSection(ctx, { programmeId: str(fd, "programmeId"), semester: int(fd, "semester"), name: str(fd, "name"), academicYear: str(fd, "academicYear") });
    return "Section created.";
  });
}
export async function createSubjectAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const s = await academics.createSubject(ctx, { departmentId: str(fd, "departmentId"), programmeId: optStr(fd, "programmeId"), semester: int(fd, "semester"), code: str(fd, "code"), name: str(fd, "name"), credits: int(fd, "credits"), kind: str(fd, "kind") });
    return `Subject ${s.code} created.`;
  });
}
export async function assignClassAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await academics.assignClass(ctx, { facultyId: str(fd, "facultyId"), subjectId: str(fd, "subjectId"), sectionId: str(fd, "sectionId") });
    return "Teaching assignment added.";
  });
}
export async function unassignClassAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await academics.unassignClass(ctx, str(fd, "id"));
    return "Teaching assignment removed.";
  });
}

// ---------------------------------------------------------------- Students

function studentFromForm(fd: FormData): students.StudentInput {
  return {
    enrollmentNo: str(fd, "enrollmentNo"),
    fullName: str(fd, "fullName"),
    email: optStr(fd, "email")?.toLowerCase() ?? null,
    phone: optStr(fd, "phone"),
    dateOfBirth: optStr(fd, "dateOfBirth"),
    gender: optStr(fd, "gender"),
    guardianName: optStr(fd, "guardianName"),
    guardianPhone: optStr(fd, "guardianPhone"),
    address: optStr(fd, "address"),
    bloodGroup: optStr(fd, "bloodGroup"),
    departmentId: optStr(fd, "departmentId"),
    programmeId: optStr(fd, "programmeId"),
    sectionId: optStr(fd, "sectionId"),
    semester: int(fd, "semester"),
    academicYear: str(fd, "academicYear"),
    admissionYear: intOrNull(fd, "admissionYear"),
    status: (optStr(fd, "status") ?? "active") as students.StudentInput["status"],
  };
}

export async function createStudentAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const s = await students.createStudent(ctx, studentFromForm(fd));
    const photo = fd.get("photo");
    if (photo instanceof File && photo.size > 0) await students.uploadStudentPhoto(ctx, s.id, photo);
    return { message: `Student ${s.enrollmentNo} created.`, to: `/c/${ctx.institution.slug}/admin/students/${s.id}` };
  });
}
export async function updateStudentAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const id = str(fd, "id");
    const s = await students.updateStudent(ctx, id, studentFromForm(fd));
    return { message: "Student updated.", to: `/c/${ctx.institution.slug}/admin/students/${s.id}` };
  });
}
export async function bulkStudentStatusAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const n = await students.setStudentStatus(ctx, list(fd, "ids"), str(fd, "status") as never);
    return `Updated ${n} student(s).`;
  });
}
export async function uploadPhotoAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await students.uploadStudentPhoto(ctx, str(fd, "id"), fd.get("photo") as File);
    return "Photograph updated.";
  });
}
export async function uploadDocumentAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await students.uploadStudentDocument(ctx, str(fd, "id"), fd.get("file") as File, str(fd, "label"));
    return "Document uploaded.";
  });
}
export async function enablePortalAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const res = await students.enablePortalAccess(ctx, str(fd, "id"));
    await stashCredential(ctx.institution.slug, res.email, res.tempPassword);
    return "Portal access enabled.";
  });
}
export async function disablePortalAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await students.disablePortalAccess(ctx, str(fd, "id"));
    return "Portal access disabled.";
  });
}

async function readImportFile(file: File): Promise<Record<string, string>[]> {
  if (!file || file.size === 0) throw badRequest("Choose a CSV or XLSX file.");
  if (file.size > 4 * 1024 * 1024) throw badRequest("Import files are limited to 4 MB.");
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());
  if (name.endsWith(".csv")) return parseCsv(buf.toString("utf8"));
  if (name.endsWith(".xlsx")) {
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw badRequest("That file is not a valid XLSX workbook.");
    const { readSheet } = await import("read-excel-file/node");
    const rows = (await readSheet(buf)) as unknown[][];
    return sheetToRecords(rows);
  }
  throw badRequest("Only .csv and .xlsx files are supported.");
}

/** Validates and imports. Invalid rows are skipped and reported; valid rows are committed in one transaction. */
export async function importStudentsAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const file = fd.get("file") as File;
    const raw = await readImportFile(file);
    if (!raw.length) throw badRequest("The file has no data rows.");
    const dryRun = bool(fd, "dryRun");
    const res = dryRun ? { ...(await students.previewImport(ctx, raw)), imported: 0 } : { ...(await students.commitImport(ctx, raw, file.name)), resolved: [] };
    const issueText = res.issues
      .slice(0, 15)
      .map((i) => `Row ${i.row}${i.enrollmentNo ? ` (${i.enrollmentNo})` : ""}: ${i.errors.join("; ")}`)
      .join("\n");
    const head = dryRun
      ? `Validation: ${res.resolved.length} of ${res.totalRows} rows are ready to import, ${res.issues.length} have problems.`
      : `Imported ${res.imported} of ${res.totalRows} rows. ${res.issues.length} row(s) skipped.`;
    return `${head}${issueText ? `\n${issueText}${res.issues.length > 15 ? `\n…and ${res.issues.length - 15} more` : ""}` : ""}`;
  });
}

// ---------------------------------------------------------------- Faculty & staff

const facultyFromForm = (fd: FormData) => ({
  employeeCode: str(fd, "employeeCode"),
  name: str(fd, "name"),
  email: optStr(fd, "email")?.toLowerCase() ?? null,
  phone: optStr(fd, "phone"),
  designation: optStr(fd, "designation"),
  departmentId: optStr(fd, "departmentId"),
});

export async function createFacultyAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const f = await people.createFaculty(ctx, facultyFromForm(fd));
    return `Added ${f.name}.`;
  });
}
export async function updateFacultyAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await people.updateFaculty(ctx, str(fd, "id"), { ...facultyFromForm(fd), status: str(fd, "status") });
    return "Faculty record updated.";
  });
}
export async function grantStaffAccessAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const res = await people.grantStaffAccess(ctx, str(fd, "id"), str(fd, "role"));
    await stashCredential(ctx.institution.slug, res.email, res.tempPassword);
    return "Access granted.";
  });
}
export async function createStaffUserAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const res = await people.createStaffUser(ctx, { name: str(fd, "name"), email: str(fd, "email"), role: str(fd, "role"), departmentId: optStr(fd, "departmentId") });
    await stashCredential(ctx.institution.slug, res.email, res.tempPassword);
    return "Staff account created.";
  });
}
export async function updateMembershipAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await people.updateMembership(ctx, str(fd, "id"), { role: str(fd, "role"), status: str(fd, "status"), departmentId: optStr(fd, "departmentId") });
    return "Account updated.";
  });
}

// ---------------------------------------------------------------- Attendance

export async function markAttendanceAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const statuses: Record<string, string> = {};
    for (const [k, v] of fd.entries()) if (k.startsWith("s_")) statuses[k.slice(2)] = String(v);
    await attendance.markAttendance(ctx, { classAssignmentId: str(fd, "classAssignmentId"), date: str(fd, "date"), period: int(fd, "period"), topic: optStr(fd, "topic"), statuses: statuses as never });
    return "Attendance saved.";
  });
}
export async function requestCorrectionAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await attendance.requestCorrection(ctx, { recordId: str(fd, "recordId"), toStatus: str(fd, "toStatus"), reason: str(fd, "reason") });
    return "Correction request submitted for approval.";
  });
}
export async function reviewCorrectionAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const decision = str(fd, "decision") === "approved" ? "approved" : "rejected";
    await attendance.reviewCorrection(ctx, str(fd, "id"), decision);
    return `Correction ${decision}.`;
  });
}

// ---------------------------------------------------------------- Assessments

export async function createAssessmentAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const [subjectId, sectionId] = str(fd, "class").split(":");
    const a = await assessments.createAssessment(ctx, {
      subjectId,
      sectionId,
      name: str(fd, "name"),
      category: str(fd, "category"),
      maxMarks: Number(str(fd, "maxMarks")),
      examDate: optStr(fd, "examDate"),
      startTime: optStr(fd, "startTime"),
      endTime: optStr(fd, "endTime"),
      room: optStr(fd, "room"),
    });
    return { message: "Assessment created. Enter marks below.", to: `/c/${ctx.institution.slug}/admin/exams/${a.id}` };
  });
}
export async function enterMarksAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const entries = [...fd.entries()].filter(([k]) => k.startsWith("m_")).map(([k, v]) => ({ studentId: k.slice(2), value: String(v) }));
    await assessments.enterMarks(ctx, str(fd, "id"), entries);
    return "Marks saved.";
  });
}
export async function transitionAssessmentAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const to = str(fd, "to") as "submitted" | "approved" | "published" | "draft";
    await assessments.transitionAssessment(ctx, str(fd, "id"), to, optStr(fd, "reason") ?? undefined);
    return { submitted: "Submitted for approval.", approved: "Marks approved.", published: "Results published to students.", draft: "Reopened for correction." }[to];
  });
}

// ---------------------------------------------------------------- Timetable

export async function addTimetableAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await timetable.addTimetableEntry(ctx, { sectionId: str(fd, "sectionId"), subjectId: str(fd, "subjectId"), facultyId: optStr(fd, "facultyId"), room: str(fd, "room"), dayOfWeek: int(fd, "dayOfWeek"), startTime: str(fd, "startTime"), endTime: str(fd, "endTime") });
    return "Slot added — no conflicts found.";
  });
}
export async function removeTimetableAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await timetable.removeTimetableEntry(ctx, str(fd, "id"));
    return "Slot removed.";
  });
}
export async function addEventAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await timetable.addCalendarEvent(ctx, { title: str(fd, "title"), kind: str(fd, "kind") as never, startDate: str(fd, "startDate"), endDate: optStr(fd, "endDate"), sectionId: optStr(fd, "sectionId"), description: optStr(fd, "description") });
    return "Calendar entry added.";
  });
}
export async function removeEventAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await timetable.removeCalendarEvent(ctx, str(fd, "id"));
    return "Calendar entry removed.";
  });
}

// ---------------------------------------------------------------- Timetable images

function timetableMeta(fd: FormData): timetableImages.TimetableMeta {
  return {
    title: str(fd, "title"),
    kind: str(fd, "kind") === "exam" ? "exam" : "class",
    departmentId: optStr(fd, "departmentId"),
    programmeId: optStr(fd, "programmeId"),
    semester: intOrNull(fd, "semester"),
    sectionId: optStr(fd, "sectionId"),
    academicYear: optStr(fd, "academicYear"),
  };
}
export async function uploadTimetableImageAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const publish = str(fd, "intent") === "publish";
    await timetableImages.createTimetableImage(ctx, timetableMeta(fd), fileOrNull(fd, "image"), publish);
    return publish ? "Timetable uploaded and published." : "Timetable uploaded as a draft.";
  });
}
export async function updateTimetableImageAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const replacement = fileOrNull(fd, "image");
    await timetableImages.updateTimetableImage(ctx, str(fd, "id"), timetableMeta(fd), replacement);
    return replacement ? "Timetable image replaced. The previous version is kept in history." : "Timetable details saved.";
  });
}
export async function timetableImageStatusAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const action = str(fd, "action") as "publish" | "unpublish" | "archive" | "restore" | "delete";
    await timetableImages.setTimetableImageStatus(ctx, str(fd, "id"), action);
    if (action === "delete") return { message: "Timetable deleted.", to: `/c/${ctx.institution.slug}/admin/timetable` };
    return `Timetable ${{ publish: "published", unpublish: "unpublished", archive: "archived", restore: "restored as draft" }[action] ?? "updated"}.`;
  });
}

// ---------------------------------------------------------------- Notices

function noticeFromForm(fd: FormData): notices.NoticeInput {
  const scope = str(fd, "scope") === "targeted" ? "targeted" : "all";
  const audienceType = str(fd, "audienceType") === "teachers" ? "teachers" : "students";
  return {
    title: str(fd, "title"),
    body: str(fd, "body"),
    category: str(fd, "category") as never,
    pinned: bool(fd, "pinned"),
    publishAt: dateOrNull(fd, "publishAt"),
    expiresAt: dateOrNull(fd, "expiresAt"),
    publish: str(fd, "intent") === "publish",
    notifyEmail: bool(fd, "notifyEmail"),
    audienceType,
    imagePosition: (["top", "center", "bottom"].includes(str(fd, "imagePosition")) ? str(fd, "imagePosition") : "center") as "center",
    audience:
      audienceType === "teachers"
        ? { scope, departmentIds: list(fd, "departmentIds") }
        : { scope, departmentIds: list(fd, "departmentIds"), programmeIds: list(fd, "programmeIds"), semesters: list(fd, "semesters").map(Number), sectionIds: list(fd, "sectionIds"), studentIds: [] },
  };
}

const fileOrNull = (fd: FormData, k: string) => {
  const f = fd.get(k);
  return f instanceof File && f.size > 0 ? f : null;
};

export async function createNoticeAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const input = noticeFromForm(fd);
    const n = await notices.createNotice(ctx, input, fileOrNull(fd, "attachment"), fileOrNull(fd, "image"));
    const to = `/c/${ctx.institution.slug}/admin/notices?tab=${input.audienceType}`;
    return { message: n.status === "published" ? `Notice published to ${input.audienceType}.` : "Draft saved.", to };
  });
}
export async function updateNoticeAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const input = noticeFromForm(fd);
    const n = await notices.updateNotice(ctx, str(fd, "id"), { ...input, majorUpdate: bool(fd, "majorUpdate") }, { image: fileOrNull(fd, "image"), removeImage: bool(fd, "removeImage"), attachment: fileOrNull(fd, "attachment") });
    return { message: n.status === "published" ? "Notice updated." : "Draft saved.", to: `/c/${ctx.institution.slug}/admin/notices?tab=${n.audienceType}` };
  });
}
export async function noticeStatusAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const action = str(fd, "action") as "publish" | "unpublish" | "pin" | "unpin" | "archive" | "delete";
    await notices.setNoticeStatus(ctx, str(fd, "id"), action);
    const done = { publish: "published", unpublish: "unpublished", pin: "pinned", unpin: "unpinned", archive: "archived", delete: "deleted" }[action];
    return `Notice ${done ?? "updated"}.`;
  });
}

// ---------------------------------------------------------------- Coursework

const filesOf = (fd: FormData, k: string) => fd.getAll(k).filter((f): f is File => f instanceof File && f.size > 0);

export async function createCourseworkAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const [subjectId, sectionId] = str(fd, "class").split(":");
    const kind = str(fd, "kind") === "material" ? "material" : "assignment";
    const images = filesOf(fd, "images");
    if (kind === "assignment" && !images.length) throw badRequest("Add at least one assignment image (JPG, PNG or WebP).");
    const row = await coursework.createCoursework(
      ctx,
      {
        subjectId,
        sectionId,
        kind,
        title: str(fd, "title"),
        instructions: optStr(fd, "instructions"),
        dueAt: dateOrNull(fd, "dueAt"),
        maxMarks: intOrNull(fd, "maxMarks"),
        acceptSubmissions: bool(fd, "acceptSubmissions"),
        status: str(fd, "intent") === "draft" ? "draft" : "published",
      },
      fileOrNull(fd, "attachment"),
      images,
    );
    return { message: row.status === "published" ? "Published to the class." : "Saved as draft.", to: `/c/${ctx.institution.slug}/admin/coursework/${row.id}` };
  });
}
export async function updateCourseworkAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await coursework.updateCoursework(ctx, str(fd, "id"), { title: str(fd, "title"), instructions: optStr(fd, "instructions"), dueAt: dateOrNull(fd, "dueAt"), maxMarks: intOrNull(fd, "maxMarks") });
    return "Assignment updated.";
  });
}
export async function addCourseworkImagesAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await coursework.addCourseworkImages(ctx, str(fd, "id"), filesOf(fd, "images"));
    return "Images added.";
  });
}
export async function removeCourseworkFileAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await coursework.removeCourseworkFile(ctx, str(fd, "id"), str(fd, "fileId"));
    return "Image removed.";
  });
}
export async function courseworkStatusAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const action = str(fd, "action") as "publish" | "unpublish" | "archive" | "delete";
    await coursework.setCourseworkStatus(ctx, str(fd, "id"), action);
    if (action === "delete") return { message: "Assignment deleted.", to: `/c/${ctx.institution.slug}/admin/coursework` };
    return `Assignment ${{ publish: "published", unpublish: "unpublished", archive: "archived" }[action] ?? "updated"}.`;
  });
}
export async function gradeSubmissionAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await coursework.gradeSubmission(ctx, str(fd, "id"), intOrNull(fd, "grade"), optStr(fd, "feedback"));
    return "Feedback saved.";
  });
}

// ---------------------------------------------------------------- Fees

export async function addFeeDemandAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const base = { category: str(fd, "category") as never, description: optStr(fd, "description"), amount: parseRupeesToMinor(str(fd, "amount")), dueDate: optStr(fd, "dueDate"), academicYear: str(fd, "academicYear") };
    if (optStr(fd, "studentId")) {
      await finance.addFeeDemand(ctx, { ...base, studentId: str(fd, "studentId") });
      return "Fee added.";
    }
    const n = await finance.bulkFeeDemand(ctx, { ...base, programmeId: optStr(fd, "programmeId"), semester: intOrNull(fd, "semester") });
    return `Fee raised for ${n} student(s).`;
  });
}
export async function recordPaymentAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const p = await finance.recordPayment(ctx, { studentId: str(fd, "studentId"), demandId: optStr(fd, "demandId"), amount: parseRupeesToMinor(str(fd, "amount")), method: str(fd, "method") as never, reference: optStr(fd, "reference"), paidAt: dateOrNull(fd, "paidAt") ?? new Date() });
    return `Payment recorded — receipt ${p.receiptNo}.`;
  });
}
export async function reconcilePaymentAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await finance.reconcilePayment(ctx, str(fd, "id"));
    return "Payment reconciled.";
  });
}

// ---------------------------------------------------------------- Library

export async function addBookAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await library.addBook(ctx, { accessionNo: str(fd, "accessionNo"), isbn: optStr(fd, "isbn"), title: str(fd, "title"), author: optStr(fd, "author") });
    return "Book catalogued.";
  });
}
export async function issueBookAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await library.issueBook(ctx, { accessionNo: str(fd, "accessionNo"), enrollmentNo: str(fd, "enrollmentNo") });
    return "Book issued.";
  });
}
export async function loanAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const op = str(fd, "op");
    if (op === "return") await library.returnBook(ctx, str(fd, "id"));
    else if (op === "renew") await library.renewLoan(ctx, str(fd, "id"));
    else if (op === "finePaid") await library.markFinePaid(ctx, str(fd, "id"));
    else throw badRequest("Unknown action");
    return { return: "Book returned.", renew: "Loan renewed.", finePaid: "Fine marked as paid." }[op];
  });
}

// ---------------------------------------------------------------- Transport

export async function createRouteAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await transport.createRoute(ctx, { code: str(fd, "code"), name: str(fd, "name"), vehicleNo: optStr(fd, "vehicleNo"), driverName: optStr(fd, "driverName"), contactPhone: optStr(fd, "contactPhone") });
    return "Route created.";
  });
}
export async function updateRouteAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await transport.updateRoute(ctx, str(fd, "id"), { vehicleNo: optStr(fd, "vehicleNo"), driverName: optStr(fd, "driverName"), contactPhone: optStr(fd, "contactPhone"), active: bool(fd, "active") });
    return "Route updated.";
  });
}
export async function addStopAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await transport.addStop(ctx, { routeId: str(fd, "routeId"), name: str(fd, "name"), sequence: int(fd, "sequence"), pickupTime: str(fd, "pickupTime"), dropTime: str(fd, "dropTime") });
    return "Stop added.";
  });
}
export async function assignTransportAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await transport.assignTransport(ctx, { enrollmentNo: str(fd, "enrollmentNo"), routeId: str(fd, "routeId"), stopId: optStr(fd, "stopId") });
    return "Transport assigned.";
  });
}
export async function removeTransportAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await transport.removeTransport(ctx, str(fd, "studentId"));
    return "Transport removed.";
  });
}

// ---------------------------------------------------------------- NFC cards

export async function registerCardsAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const r = await cards.registerCards(ctx, str(fd, "serials").split(/[\s,;]+/));
    return `Registered ${r.created} card(s)${r.skipped ? `; ${r.skipped} already existed` : ""}.`;
  });
}
export async function assignCardAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const cardId = str(fd, "cardId");
    await cards.assignCard(ctx, cardId, str(fd, "studentId"), optStr(fd, "validUntil"));
    return { message: "Card assigned. Encode the URL below onto the NFC tag.", to: `/c/${ctx.institution.slug}/admin/cards/${cardId}` };
  });
}
export async function cardOpAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const id = str(fd, "id");
    const op = str(fd, "op");
    switch (op) {
      case "activate":
        await cards.setCardActive(ctx, id, true);
        return "Card activated.";
      case "deactivate":
        await cards.setCardActive(ctx, id, false);
        return "Card deactivated. Taps will show “card not active”.";
      case "lost":
      case "damaged":
      case "revoked":
        await cards.retireCard(ctx, id, op, optStr(fd, "notes") ?? undefined);
        return `Card marked ${op}. Its URL no longer works.`;
      case "rotate":
        await cards.rotateCardToken(ctx, id);
        return "New URL issued. Re-encode the tag — the old URL is now invalid.";
      case "replace": {
        const newId = str(fd, "newCardId");
        await cards.replaceCard(ctx, id, newId, str(fd, "reason") === "damaged" ? "damaged" : "lost");
        return { message: "Replacement card linked to the same student record.", to: `/c/${ctx.institution.slug}/admin/cards/${newId}` };
      }
      default:
        throw badRequest("Unknown card action.");
    }
  });
}

// ---------------------------------------------------------------- Portal designer & settings

export async function savePublicFieldsAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await settings.savePublicFields(ctx, list(fd, "publicFields").filter((f) => PUBLIC_FIELDS.some((p) => p.key === f)));
    return "NFC tap-page fields saved. They apply immediately.";
  });
}
export async function saveAcademicAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const scale = str(fd, "gradeScale")
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [min, grade, point] = l.split(/[,\s]+/);
        return { min: Number(min), grade, point: Number(point) };
      });
    await settings.saveAcademicSettings(ctx, {
      attendanceThreshold: Number(str(fd, "attendanceThreshold")),
      lateCountsAsPresent: bool(fd, "lateCountsAsPresent"),
      excludeExcused: bool(fd, "excludeExcused"),
      passPercentage: Number(str(fd, "passPercentage")),
      gradeScale: scale,
    });
    return "Academic rules saved.";
  });
}
export async function savePermissionsAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const granted: Record<string, string[]> = {};
    for (const role of ROLES) granted[role] = Object.keys(PERMISSIONS).filter((p) => fd.get(`${role}:${p}`) === "on");
    await settings.savePermissionOverrides(ctx, granted);
    return "Role permissions saved.";
  });
}
export async function grantSupportAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await settings.grantSupport(ctx, int(fd, "hours"), str(fd, "reason"));
    return "Support access granted.";
  });
}
export async function revokeSupportAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    await settings.revokeSupport(ctx, str(fd, "id"));
    return "Support access revoked.";
  });
}
