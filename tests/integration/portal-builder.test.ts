/**
 * Acceptance tests for the super-admin Portal Builder, server-enforced data flags,
 * image timetables, student/teacher notices with read receipts and image assignments.
 * Runs against a real PostgreSQL (PGlite) seeded through the production service layer.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { setDb, getDb, type Database } from "@/db";
import * as schema from "@/db/schema";
import { runMigrations } from "@/db/migrate";
import { loadTenantContext, type TenantContext } from "@/server/context";
import { AppError } from "@/lib/errors";
import { COLLEGES, seedCollege } from "../../scripts/seed-data";
import * as portal from "@/server/services/portal";
import * as builder from "@/server/services/portal-builder";
import * as notices from "@/server/services/notices";
import * as coursework from "@/server/services/coursework";
import * as tt from "@/server/services/timetable-images";
import * as finance from "@/server/services/finance";
import { studentAttendance } from "@/server/services/attendance";
import { publishedResultsForStudent } from "@/server/services/assessments";
import { actionableClasses } from "@/server/services/academics";

// Uploads go to a throwaway local folder, never to real object storage.
process.env.STORAGE_DIR = mkdtempSync(path.join(tmpdir(), "msc-test-"));
for (const k of ["STORAGE_ENDPOINT_URL", "AWS_ENDPOINT_URL_S3", "STORAGE_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"]) delete process.env[k];

const small = COLLEGES.map((c) => ({ ...c, studentsPerSection: 4 }));
type User = typeof schema.users.$inferSelect;

async function user(email: string): Promise<User> {
  const [u] = await getDb().select().from(schema.users).where(eq(schema.users.email, email));
  return u;
}
const ctxFor = async (email: string, slug: string) => loadTenantContext(await user(email), slug);
const denied = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(AppError);
const studentView = async (email = "student1@northbridge.test", slug = "northbridge") => portal.viewerForStudent(await ctxFor(email, slug));

/** A small but structurally valid PNG (signature + IHDR + IDAT + IEND). */
function png(name = "timetable.png") {
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return new File([Buffer.from(b64, "base64")], name, { type: "image/png" });
}

let sa: User;
let A: TenantContext; // Northbridge admin
let B: TenantContext; // Riverside admin
let nb: string;
let rv: string;

beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as Database;
  setDb(db);
  await runMigrations(db, "pglite");
  for (const c of small) await seedCollege(c);
  sa = await user("platform@mysmartcard.test");
  A = await ctxFor("admin@northbridge.test", "northbridge");
  B = await ctxFor("admin@riverside.test", "riverside");
  nb = A.institution.id;
  rv = B.institution.id;
});

describe("student portal hides restricted data by default (1–5)", () => {
  it("attendance, fees and transport sections are unavailable and unloadable", async () => {
    const v = await studentView();
    const me = (await portal.portalStudent(v)).student;
    const mods = portal.visibleModules(v, me);
    expect(mods).not.toContain("attendance");
    expect(mods).not.toContain("fees");
    expect(mods).not.toContain("transport");
    expect(mods).toEqual(expect.arrayContaining(["digital_id", "results", "internal_marks", "timetable", "notices", "coursework", "library"]));
    await denied(portal.loadModule(v, "attendance"));
    await denied(portal.loadModule(v, "fees"));
    await denied(portal.loadModule(v, "transport"));
  });

  it("home data never contains attendance, CGPA, fee balance or due counts", async () => {
    const h = await portal.portalHome(await studentView());
    expect(h.attendance).toBeNull();
    expect(h.cgpa).toBeNull();
    expect(h.balance).toBeNull();
    expect(h.dueAssignments).toBeNull();
    const json = JSON.stringify(h);
    expect(json).not.toMatch(/"percentage"|"balance":\d|"sgpa":\d/);
  });

  it("results stay visible without CGPA/SGPA, and assignment due dates are stripped", async () => {
    const v = await studentView();
    const r = await portal.loadModule(v, "results");
    if (r.key !== "results") throw new Error("unexpected");
    expect(r.data.cgpa).toBeNull();
    expect(r.data.semesters.every((s) => s.sgpa === null)).toBe(true);
    const c = await portal.loadModule(v, "coursework");
    if (c.key !== "coursework") throw new Error("unexpected");
    expect(c.items.length).toBeGreaterThan(0);
    expect(c.items.every((i) => i.item.dueAt === null)).toBe(true);
  });

  it("students cannot open fee receipts while fees are hidden", async () => {
    const st = await ctxFor("student1@northbridge.test", "northbridge");
    const pay = await finance.recordPayment(A, { studentId: st.studentId!, demandId: null, amount: 500, method: "cash", reference: null, paidAt: new Date() });
    await denied(finance.receipt(st, pay.id));
    expect((await finance.receipt(A, pay.id)).payment.id).toBe(pay.id);
  });

  it("administrators keep full access to the hidden records (6)", async () => {
    const st = await ctxFor("student1@northbridge.test", "northbridge");
    const att = await studentAttendance(A, st.studentId!);
    expect(att.overall).toBeTruthy();
    const ledger = await finance.studentLedger(A, st.studentId!);
    expect(ledger.payments.length).toBeGreaterThan(0);
    const results = await publishedResultsForStudent(A, st.studentId!);
    expect(results).toHaveProperty("cgpa");
    const cw = await coursework.listCourseworkForStaff(A);
    expect(cw.some((r) => r.item.dueAt !== null)).toBe(true);
  });
});

describe("super-admin Portal Builder (7–9)", () => {
  it("enables attendance for one college only", async () => {
    await builder.saveCollegeDraft(sa, nb, { modules: {}, features: { showAttendance: true } });
    await builder.publishCollege(sa, nb);
    const v = await studentView();
    expect(portal.visibleModules(v, (await portal.portalStudent(v)).student)).toContain("attendance");
    expect(await portal.loadModule(v, "attendance")).toBeTruthy();
    expect((await portal.portalHome(v)).attendance).not.toBeNull();
    const other = await studentView("student1@riverside.test", "riverside");
    await denied(portal.loadModule(other, "attendance"));
  });

  it("flags are independent: CGPA on does not reveal fees or transport", async () => {
    await builder.saveCollegeDraft(sa, nb, { modules: {}, features: { showAttendance: true, showCGPA: true } });
    await builder.publishCollege(sa, nb);
    const v = await studentView();
    const st = await ctxFor("student1@northbridge.test", "northbridge");
    const r = await portal.loadModule(v, "results");
    if (r.key !== "results") throw new Error("unexpected");
    expect(r.data.cgpa).toBe((await publishedResultsForStudent(A, st.studentId!)).cgpa);
    await denied(portal.loadModule(v, "fees"));
    await denied(portal.loadModule(v, "transport"));
    const c = await portal.loadModule(v, "coursework");
    if (c.key !== "coursework") throw new Error("unexpected");
    expect(c.items.every((i) => i.item.dueAt === null)).toBe(true);
  });

  it("fee balance and fee due reminders are separate switches; deadlines can be enabled", async () => {
    await builder.saveCollegeDraft(sa, nb, { modules: {}, features: { showFeeBalance: true, showAssignmentDeadlines: true } });
    await builder.publishCollege(sa, nb);
    const v = await studentView();
    const f = await portal.loadModule(v, "fees");
    if (f.key !== "fees") throw new Error("unexpected");
    expect(f.ledger.demands.every((d) => d.dueDate === null && d.status !== "overdue")).toBe(true);
    const c = await portal.loadModule(v, "coursework");
    if (c.key !== "coursework") throw new Error("unexpected");
    expect(c.items.some((i) => i.item.dueAt !== null)).toBe(true);
    // Attendance and CGPA were not re-specified in this override, so they fall back to the hidden default.
    await denied(portal.loadModule(v, "attendance"));
  });

  it("a global change does not overwrite an explicit college override", async () => {
    await builder.saveCollegeDraft(sa, nb, { modules: {}, features: { showTransport: false } });
    await builder.publishCollege(sa, nb);
    await builder.saveGlobalDraft(sa, { modules: {}, features: { showTransport: true } });
    // Global draft is not live yet
    await denied(portal.loadModule(await studentView("student1@riverside.test", "riverside"), "transport"));
    await builder.publishGlobal(sa);
    expect(await portal.loadModule(await studentView("student1@riverside.test", "riverside"), "transport")).toBeTruthy();
    await denied(portal.loadModule(await studentView(), "transport"));
    // Clearing the override makes the college follow the global default again.
    await builder.saveCollegeDraft(sa, nb, { modules: {}, features: {} });
    await builder.publishCollege(sa, nb);
    expect(await portal.loadModule(await studentView(), "transport")).toBeTruthy();
    // Roll the global defaults back to the original published version.
    const hist = await builder.policyHistory(sa, null);
    await builder.saveGlobalDraft(sa, { modules: {}, features: { showTransport: false } });
    await builder.publishGlobal(sa);
    expect(hist.length).toBeGreaterThan(0);
    await denied(portal.loadModule(await studentView(), "transport"));
  });

  it("section order and visibility come from the builder", async () => {
    await builder.saveCollegeDraft(sa, nb, { modules: { library: { order: 0 }, internal_marks: { enabled: false } }, features: {} });
    await builder.publishCollege(sa, nb);
    const v = await studentView();
    const mods = portal.visibleModules(v, (await portal.portalStudent(v)).student);
    expect(mods.indexOf("library")).toBeLessThan(mods.indexOf("results"));
    expect(mods).not.toContain("internal_marks");
    await builder.saveCollegeDraft(sa, nb, { modules: {}, features: {} });
    await builder.publishCollege(sa, nb);
  });

  it("history records versions and rollback restores one", async () => {
    await builder.saveCollegeDraft(sa, nb, { modules: {}, features: { showCGPA: true } });
    await builder.publishCollege(sa, nb);
    const target = (await builder.policyHistory(sa, nb)).find((h) => h.entry.action === "publish")!;
    await builder.saveCollegeDraft(sa, nb, { modules: {}, features: {} });
    await builder.publishCollege(sa, nb);
    await builder.rollbackTo(sa, target.entry.id);
    const r = await portal.loadModule(await studentView(), "results");
    if (r.key !== "results") throw new Error("unexpected");
    expect(r.data).toHaveProperty("cgpa");
    expect((await ctxFor("student1@northbridge.test", "northbridge")).portalConfig.features?.showCGPA).toBe(true);
    await builder.saveCollegeDraft(sa, nb, { modules: {}, features: {} });
    await builder.publishCollege(sa, nb);
  });

  it("college admins and staff cannot use the Portal Builder (9)", async () => {
    const admin = await user("admin@northbridge.test");
    await denied(builder.saveCollegeDraft(admin, nb, { modules: {}, features: { showAttendance: true } }));
    await denied(builder.publishCollege(admin, nb));
    await denied(builder.saveGlobalDraft(admin, { modules: {}, features: {} }));
    await denied(builder.collegePolicyState(admin, nb));
    await denied(portal.viewerForPlatformPreview(A, (await ctxFor("student1@northbridge.test", "northbridge")).studentId!, A.draftConfig));
  });
});

describe("timetable images (10–11)", () => {
  it("admin uploads, the right students see and can download it, others cannot", async () => {
    const st = await ctxFor("student1@northbridge.test", "northbridge");
    const me = (await portal.portalStudent(await portal.viewerForStudent(st))).student;
    const t = await tt.createTimetableImage(A, { title: "Sem timetable", kind: "class", departmentId: null, programmeId: null, semester: null, sectionId: me.sectionId, academicYear: null }, png(), true);
    const mod = await portal.loadModule(await portal.viewerForStudent(st), "timetable");
    if (mod.key !== "timetable") throw new Error("unexpected");
    expect(mod.images.map((i) => i.t.id)).toContain(t.id);
    expect(await tt.canViewTimetableFile(st, { id: t.fileId, ownerId: t.id }, me)).toBe(true);

    const others = await getDb().select().from(schema.students).where(eq(schema.students.institutionId, nb));
    const outsider = others.find((s) => s.sectionId !== me.sectionId)!;
    expect(tt.timetableTargetsStudent(t, outsider)).toBe(false);
    expect(await tt.canViewTimetableFile(st, { id: t.fileId, ownerId: t.id }, outsider)).toBe(false);

    // Draft / unpublished timetables are invisible to students.
    await tt.setTimetableImageStatus(A, t.id, "unpublish");
    expect((await tt.timetableImagesForStudent(A, me)).map((i) => i.t.id)).not.toContain(t.id);
    await tt.setTimetableImageStatus(A, t.id, "publish");

    // Replacing keeps history; students only get the current version.
    const oldFile = t.fileId;
    await tt.updateTimetableImage(A, t.id, { title: "Sem timetable v2", kind: "class", departmentId: null, programmeId: null, semester: null, sectionId: me.sectionId, academicYear: null }, png("v2.png"));
    const d = await tt.timetableImage(A, t.id);
    expect(d.versions).toHaveLength(2);
    expect(await tt.canViewTimetableFile(st, { id: oldFile, ownerId: t.id }, me)).toBe(false);
  });

  it("rejects non-image and spoofed uploads", async () => {
    const fake = new File([Buffer.from("not really a png at all, just text padding ".repeat(4))], "x.png", { type: "image/png" });
    await denied(tt.createTimetableImage(A, { title: "Bad", kind: "class", departmentId: null, programmeId: null, semester: null, sectionId: null, academicYear: null }, fake, true));
    const pdf = new File([Buffer.from("%PDF-1.4 ".repeat(10))], "x.pdf", { type: "application/pdf" });
    await denied(tt.createTimetableImage(A, { title: "Bad", kind: "class", departmentId: null, programmeId: null, semester: null, sectionId: null, academicYear: null }, pdf, true));
  });

  it("cannot target another college's section (22)", async () => {
    const [bSection] = await getDb().select().from(schema.sections).where(eq(schema.sections.institutionId, rv));
    await denied(tt.createTimetableImage(A, { title: "Cross-college", kind: "class", departmentId: null, programmeId: null, semester: null, sectionId: bSection.id, academicYear: null }, png(), true));
  });
});

describe("student vs teacher notices, unread badges and read receipts (12–18)", () => {
  const base = { body: "Details", category: "general" as const, pinned: false, publishAt: null, expiresAt: null, publish: true, notifyEmail: false, audience: { scope: "all" as const } };

  it("keeps the two boards separate", async () => {
    const sn = await notices.createNotice(A, { ...base, title: "Student-only notice", audienceType: "students" }, null, png("notice.png"));
    const tn = await notices.createNotice(A, { ...base, title: "Teacher-only notice", audienceType: "teachers" });
    expect(sn.imageFileId).not.toBeNull();
    const st = await ctxFor("student1@northbridge.test", "northbridge");
    const sv = (await notices.noticeViewer(st))!;
    const feed = await notices.noticeFeed(st, sv, { pageSize: 50 });
    expect(feed.items.map((n) => n.title)).toContain("Student-only notice");
    expect(feed.items.map((n) => n.title)).not.toContain("Teacher-only notice");
    await denied(notices.noticeForViewer(st, sv, tn.id));

    const fac = await ctxFor("faculty2@northbridge.test", "northbridge");
    const fv = (await notices.noticeViewer(fac))!;
    expect(fv.kind).toBe("teacher");
    const tfeed = await notices.noticeFeed(fac, fv, { pageSize: 50 });
    expect(tfeed.items.map((n) => n.title)).toContain("Teacher-only notice");
    expect(tfeed.items.map((n) => n.title)).not.toContain("Student-only notice");
    await denied(notices.noticeForViewer(fac, fv, sn.id));

    // Other colleges never see them (22).
    const other = await ctxFor("student1@riverside.test", "riverside");
    const ofeed = await notices.noticeFeed(other, (await notices.noticeViewer(other))!, { pageSize: 50 });
    expect(ofeed.items.map((n) => n.id)).not.toContain(sn.id);
    await denied(notices.updateNotice(B, sn.id, { ...base, title: "Hijack" }));
  });

  it("new notices raise the unread badge; opening one marks only that one read, persistently", async () => {
    const st = await ctxFor("student1@northbridge.test", "northbridge");
    const v = (await notices.noticeViewer(st))!;
    const before = (await notices.notificationSummary(st, v)).unread;
    const n1 = await notices.createNotice(A, { ...base, title: "Fresh one" });
    const n2 = await notices.createNotice(A, { ...base, title: "Fresh two" });
    const s1 = await notices.notificationSummary(st, v);
    expect(s1.unread).toBe(before + 2);
    expect(s1.items.find((i) => i.id === n1.id)?.unread).toBe(true);

    await notices.markNoticeRead(st, v, n1.id);
    // New session / device: state comes from the database.
    const again = await ctxFor("student1@northbridge.test", "northbridge");
    const s2 = await notices.notificationSummary(again, (await notices.noticeViewer(again))!);
    expect(s2.unread).toBe(before + 1);
    expect(s2.items.find((i) => i.id === n1.id)?.unread).toBe(false);
    expect(s2.items.find((i) => i.id === n2.id)?.unread).toBe(true);

    // Re-marking is idempotent; a minor edit does not re-notify; a major update does once.
    await notices.markNoticeRead(st, v, n1.id);
    await notices.updateNotice(A, n1.id, { ...base, title: "Fresh one (typo fixed)" });
    expect((await notices.notificationSummary(st, v)).unread).toBe(before + 1);
    await notices.updateNotice(A, n1.id, { ...base, title: "Fresh one — venue changed", majorUpdate: true });
    expect((await notices.notificationSummary(st, v)).unread).toBe(before + 2);
    // Unpublish + republish keeps the revision: no duplicate notification.
    await notices.markNoticeRead(st, v, n1.id);
    await notices.setNoticeStatus(A, n1.id, "unpublish");
    await notices.setNoticeStatus(A, n1.id, "publish");
    expect((await notices.notificationSummary(st, v)).unread).toBe(before + 1);
  });

  it("archived and draft notices are not delivered", async () => {
    const st = await ctxFor("student1@northbridge.test", "northbridge");
    const v = (await notices.noticeViewer(st))!;
    const d = await notices.createNotice(A, { ...base, title: "Draft only", publish: false });
    const a = await notices.createNotice(A, { ...base, title: "To archive" });
    await notices.setNoticeStatus(A, a.id, "archive");
    const ids = (await notices.noticeFeed(st, v, { pageSize: 100 })).items.map((n) => n.id);
    expect(ids).not.toContain(d.id);
    expect(ids).not.toContain(a.id);
  });

  it("publishing a draft from the editor queues emails like the Publish button", async () => {
    const outbox = async () => (await getDb().select().from(schema.notificationOutbox).where(eq(schema.notificationOutbox.institutionId, nb))).length;
    const d = await notices.createNotice(A, { ...base, title: "Email on edit-publish", publish: false, notifyEmail: true });
    const before = await outbox();
    await notices.updateNotice(A, d.id, { ...base, title: "Email on edit-publish", notifyEmail: true });
    const after = await outbox();
    expect(after).toBeGreaterThan(before);
    // Editing an already-published notice does not email again.
    await notices.updateNotice(A, d.id, { ...base, title: "Email on edit-publish (edited)", notifyEmail: true });
    expect(await outbox()).toBe(after);
  });

  it("replacing or removing a notice image deletes the old file", async () => {
    const n = await notices.createNotice(A, { ...base, title: "Image swap" }, null, png("first.png"));
    const fileExists = async (id: string) => (await getDb().select().from(schema.files).where(eq(schema.files.id, id))).length > 0;
    const first = n.imageFileId!;
    const swapped = await notices.updateNotice(A, n.id, { ...base, title: "Image swap" }, { image: png("second.png") });
    expect(swapped.imageFileId).not.toBe(first);
    expect(await fileExists(first)).toBe(false);
    const removed = await notices.updateNotice(A, n.id, { ...base, title: "Image swap" }, { removeImage: true });
    expect(removed.imageFileId).toBeNull();
    expect(await fileExists(swapped.imageFileId!)).toBe(false);
  });

  it("the staff dashboard only lists notices addressed to that staff member", async () => {
    const fac = await ctxFor("faculty2@northbridge.test", "northbridge");
    const fv = (await notices.noticeViewer(fac))!;
    if (fv.kind !== "teacher") throw new Error("unexpected");
    const otherDept = (await getDb().select().from(schema.departments).where(eq(schema.departments.institutionId, nb))).find((d) => d.id !== fv.departmentId)!;
    const hidden = await notices.createNotice(A, { ...base, title: "Other department staff only", audienceType: "teachers", audience: { scope: "targeted", departmentIds: [otherDept.id] } });
    const student = await notices.createNotice(A, { ...base, title: "Students only (dashboard)" });
    const ids = (await notices.recentLiveNotices(fac, 100)).map((n) => n.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(student.id);
    expect((await notices.recentLiveNotices(A, 100)).map((n) => n.id)).toContain(hidden.id);
  });
});

describe("image assignments (19–20)", () => {
  it("faculty upload images for their class; students see them without deadlines", async () => {
    const fac = await ctxFor("faculty2@northbridge.test", "northbridge");
    const [cls] = await actionableClasses(fac);
    const due = new Date(Date.now() + 3 * 864e5);
    const row = await coursework.createCoursework(fac, { subjectId: cls.subjectId, sectionId: cls.sectionId, kind: "assignment", title: "Photo sheet", instructions: "Solve page 1", dueAt: due, maxMarks: null, acceptSubmissions: false }, null, [png("p1.png"), png("p2.png")]);
    const studentRow = (await getDb().select().from(schema.students).where(eq(schema.students.sectionId, cls.sectionId))).find((s) => s.userId);
    expect(studentRow).toBeTruthy();
    const [u] = await getDb().select().from(schema.users).where(eq(schema.users.id, studentRow!.userId!));
    const st = await loadTenantContext(u, "northbridge");
    const m = await portal.loadModule(await portal.viewerForStudent(st), "coursework");
    if (m.key !== "coursework") throw new Error("unexpected");
    const item = m.items.find((i) => i.item.id === row.id)!;
    expect(item.attachments.filter((a) => a.mimeType.startsWith("image/"))).toHaveLength(2);
    expect(item.item.dueAt).toBeNull();
    expect(item.publisher).toBeTruthy();
    // The deadline is still stored for administrators.
    expect((await coursework.courseworkDetail(A, row.id)).coursework.dueAt?.getTime()).toBe(due.getTime());

    // Unpublished assignments disappear for students.
    await coursework.setCourseworkStatus(fac, row.id, "unpublish");
    const m2 = await portal.loadModule(await portal.viewerForStudent(st), "coursework");
    if (m2.key !== "coursework") throw new Error("unexpected");
    expect(m2.items.map((i) => i.item.id)).not.toContain(row.id);
  });

  it("faculty cannot publish to a class they do not teach", async () => {
    const fac = await ctxFor("faculty2@northbridge.test", "northbridge");
    const mine = new Set(fac.classes.map((c) => `${c.subjectId}:${c.sectionId}`));
    const other = (await actionableClasses(A)).find((c) => !mine.has(`${c.subjectId}:${c.sectionId}`))!;
    await denied(coursework.createCoursework(fac, { subjectId: other.subjectId, sectionId: other.sectionId, kind: "assignment", title: "Nope", instructions: null, dueAt: null, maxMarks: null, acceptSubmissions: false }, null, [png()]));
  });
});