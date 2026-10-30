/**
 * End-to-end service tests against a real (in-memory) PostgreSQL via PGlite.
 * Two colleges are seeded through the production service layer; tests then
 * attack tenant isolation, role scoping, workflows and the NFC card lifecycle.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { setDb, getDb, type Database } from "@/db";
import * as schema from "@/db/schema";
import { runMigrations } from "@/db/migrate";
import { authenticate, createSession, userForSessionToken, destroySession } from "@/server/auth";
import { loadTenantContext, type TenantContext } from "@/server/context";
import { AppError } from "@/lib/errors";
import { COLLEGES, DEMO_PASSWORD, seedCollege } from "../../scripts/seed-data";
import * as students from "@/server/services/students";
import * as cards from "@/server/services/cards";
import * as attendance from "@/server/services/attendance";
import * as assessments from "@/server/services/assessments";
import * as settings from "@/server/services/settings";
import * as finance from "@/server/services/finance";
import * as people from "@/server/services/people";
import * as portal from "@/server/services/portal";
import * as notices from "@/server/services/notices";
import * as library from "@/server/services/library";
import * as timetable from "@/server/services/timetable";
import * as builder from "@/server/services/portal-builder";
import { getInstitution, setInstitutionStatus, updateInstitutionDetails } from "@/server/services/platform";
import { runRetention } from "@/server/services/maintenance";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";

const small = COLLEGES.map((c) => ({ ...c, studentsPerSection: 4 }));

async function ctxFor(email: string, slug: string) {
  const [u] = await getDb().select().from(schema.users).where(eq(schema.users.email, email));
  return loadTenantContext(u, slug);
}
async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toBeInstanceOf(AppError);
}

let A: TenantContext; // Northbridge admin
let B: TenantContext; // Riverside admin
let bStudentId: string;
let aStudentId: string;

beforeAll(async () => {
  const db = drizzle(new PGlite(), { schema }) as unknown as Database;
  setDb(db);
  await runMigrations(db, "pglite");
  for (const c of small) await seedCollege(c);
  A = await ctxFor("admin@northbridge.test", "northbridge");
  B = await ctxFor("admin@riverside.test", "riverside");
  aStudentId = (await students.listStudents(A, {})).rows[0].student.id;
  bStudentId = (await students.listStudents(B, {})).rows[0].student.id;
});

describe("authentication & sessions", () => {
  it("authenticates with the right password only and issues revocable sessions", async () => {
    expect(await authenticate("admin@northbridge.test", "wrong-password")).toBeNull();
    expect(await authenticate("nobody@northbridge.test", DEMO_PASSWORD)).toBeNull();
    const u = await authenticate("ADMIN@northbridge.test", DEMO_PASSWORD);
    expect(u?.email).toBe("admin@northbridge.test");
    const token = await createSession(u!.id);
    const s = await userForSessionToken(token);
    expect(s?.id).toBe(u!.id);
    expect(s).not.toHaveProperty("passwordHash");
    await destroySession(token);
    expect(await userForSessionToken(token)).toBeNull();
  });
});

describe("cross-college data isolation", () => {
  it("lists only the caller's own students", async () => {
    const a = await students.listStudents(A, { pageSize: 200 });
    const b = await students.listStudents(B, { pageSize: 200 });
    expect(a.total).toBe(8);
    expect(b.total).toBe(4);
    const aIds = new Set(a.rows.map((r) => r.student.id));
    expect(b.rows.some((r) => aIds.has(r.student.id))).toBe(false);
  });

  it("rejects reading, editing, archiving or carding another college's student by id", async () => {
    await expectDenied(students.getStudent(A, bStudentId));
    await expectDenied(students.updateStudent(A, bStudentId, { enrollmentNo: "HACK", fullName: "Hacked", email: null, phone: null, dateOfBirth: null, gender: null, guardianName: null, guardianPhone: null, address: null, bloodGroup: null, departmentId: null, programmeId: null, sectionId: null, semester: 1, academicYear: "2026-27", admissionYear: null, status: "active" }));
    expect(await students.setStudentStatus(A, [bStudentId], "archived")).toBe(0);
    const [stillActive] = await getDb().select().from(schema.students).where(eq(schema.students.id, bStudentId));
    expect(stillActive.status).toBe("active");
    const [freeCard] = await cards.unassignedCards(A);
    await expectDenied(cards.assignCard(A, freeCard.id, bStudentId, null));
    await expectDenied(finance.addFeeDemand(A, { studentId: bStudentId, category: "tuition", description: null, amount: 100, dueDate: null, academicYear: "2026-27" }));
    await expectDenied(finance.studentLedger(A, bStudentId).then((l) => (l.demands.length ? Promise.resolve() : Promise.reject(new AppError("empty")))));
  });

  it("rejects using another college's department/section as a foreign key", async () => {
    const bDept = (await getDb().select().from(schema.departments).where(eq(schema.departments.institutionId, B.institution.id)))[0];
    await expectDenied(
      students.createStudent(A, { enrollmentNo: "X-1", fullName: "Cross Ref", email: null, phone: null, dateOfBirth: null, gender: null, guardianName: null, guardianPhone: null, address: null, bloodGroup: null, departmentId: bDept.id, programmeId: null, sectionId: null, semester: 1, academicYear: "2026-27", admissionYear: null, status: "active" }),
    );
  });

  it("does not let a member of one college open another college's workspace", async () => {
    const [u] = await getDb().select().from(schema.users).where(eq(schema.users.email, "admin@northbridge.test"));
    await expectDenied(loadTenantContext(u, "riverside"));
    const [stu] = await getDb().select().from(schema.users).where(eq(schema.users.email, "student1@riverside.test"));
    await expectDenied(loadTenantContext(stu, "northbridge"));
  });

  it("keeps card management scoped to the owning college", async () => {
    const bCard = (await cards.listCards(B, {}))[0];
    await expectDenied(cards.liveTokenForCard(A, bCard.card.id));
    await expectDenied(cards.retireCard(A, bCard.card.id, "lost"));
    await expectDenied(cards.cardHistory(A, bCard.card.id));
  });

  it("rejects malformed ids without leaking a database error", async () => {
    await expectDenied(students.getStudent(A, "1 OR 1=1"));
    await expectDenied(cards.rotateCardToken(A, "../../etc"));
  });
});

describe("role-based access", () => {
  it("scopes faculty to students in the sections they teach and hides sensitive fields", async () => {
    const f = await ctxFor("faculty2@northbridge.test", "northbridge");
    expect(f.role).toBe("faculty");
    const res = await students.listStudents(f, {});
    expect(res.total).toBe(4); // one section
    expect(res.rows.every((r) => r.student.dateOfBirth === null && r.student.address === null)).toBe(true);
    await expectDenied(students.createStudent(f, {} as never));
    await expectDenied(cards.listCards(f, {}));
    await expectDenied(settings.savePublicFields(f, ["fullName"]));
  });

  it("scopes HOD to their own department", async () => {
    const h = await ctxFor("faculty1@northbridge.test", "northbridge");
    expect(h.role).toBe("hod");
    const res = await students.listStudents(h, { pageSize: 200 });
    expect(res.rows.every((r) => r.student.departmentId === h.departmentId)).toBe(true);
    const other = (await students.listStudents(A, { pageSize: 200 })).rows.find((r) => r.student.departmentId !== h.departmentId)!;
    await expectDenied(students.getStudent(h, other.student.id));
  });

  it("prevents faculty from marking attendance for a class they do not teach", async () => {
    const f = await ctxFor("faculty2@northbridge.test", "northbridge");
    const classes = await (await import("@/server/services/academics")).listClassAssignments(A);
    const notMine = classes.find((c) => !f.classes.some((m) => m.id === c.id))!;
    await expectDenied(attendance.attendanceSheet(f, notMine.id, "2026-01-05", 1));
  });

  it("the platform super admin can manage any college, and every write is attributed to the platform", async () => {
    const [sa] = await getDb().select().from(schema.users).where(eq(schema.users.email, "platform@mysmartcard.test"));
    const sup = await loadTenantContext(sa, "riverside");
    expect(sup.viaPlatform).toBe(true);
    expect(sup.viaSupport).toBe(false);
    expect((await students.listStudents(sup, {})).total).toBe(4);
    await students.setStudentStatus(sup, [bStudentId], "inactive");
    await students.setStudentStatus(sup, [bStudentId], "active");
    const logs = await getDb().select().from(schema.auditLogs).where(and(eq(schema.auditLogs.institutionId, B.institution.id), eq(schema.auditLogs.actorUserId, sa.id), eq(schema.auditLogs.entityType, "student")));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((l) => l.actorName?.includes("(MySmartCard platform)"))).toBe(true);
    // A college admin is still confined to their own college.
    const [ra] = await getDb().select().from(schema.users).where(eq(schema.users.email, "admin@riverside.test"));
    await expectDenied(loadTenantContext(ra, "northbridge"));
  });

  it("blocks users of a suspended college", async () => {
    const [sa] = await getDb().select().from(schema.users).where(eq(schema.users.email, "platform@mysmartcard.test"));
    await setInstitutionStatus(sa, B.institution.id, "suspended", "test");
    const [u] = await getDb().select().from(schema.users).where(eq(schema.users.email, "admin@riverside.test"));
    await expectDenied(loadTenantContext(u, "riverside"));
    await setInstitutionStatus(sa, B.institution.id, "active", "test done");
    B = await loadTenantContext(u, "riverside");
  });

  it("a college cannot remove its last administrator", async () => {
    const staff = await people.listStaff(A);
    const me = staff.find((s) => s.user.email === "admin@northbridge.test")!;
    await expectDenied(people.updateMembership(A, me.membership.id, { role: "faculty", status: "active", departmentId: null }));
  });
});

describe("examinations and results", () => {
  it("students only ever see published results", async () => {
    const st = await ctxFor("student1@northbridge.test", "northbridge");
    const res = await assessments.publishedResultsForStudent(st, st.studentId!);
    expect(res.assessments.length).toBeGreaterThan(0);
    const statuses = await getDb()
      .select({ status: schema.assessments.status })
      .from(schema.assessments)
      .where(eq(schema.assessments.institutionId, A.institution.id));
    expect(statuses.some((s) => s.status === "submitted")).toBe(true); // midterms exist but are not published
    expect(res.assessments.every((a) => a.category !== "midterm")).toBe(true);
    expect(res.cgpa).not.toBeNull();
  });

  it("locks marks after submission, requires a different approver, and audits reopen", async () => {
    const f = await ctxFor("faculty2@northbridge.test", "northbridge");
    const mine = f.classes[0];
    const a = await assessments.createAssessment(f, { subjectId: mine.subjectId, sectionId: mine.sectionId, name: "Quiz", category: "class_test", maxMarks: 10, examDate: null, startTime: null, endTime: null, room: null });
    const sheet = await assessments.marksSheet(f, a.id);
    await expectDenied(assessments.enterMarks(f, a.id, [{ studentId: sheet.rows[0].id, value: "11" }])); // > max
    await expectDenied(assessments.transitionAssessment(f, a.id, "submitted")); // incomplete
    await assessments.enterMarks(f, a.id, sheet.rows.map((r, i) => ({ studentId: r.id, value: i === 0 ? "AB" : "7.5" })));
    await assessments.transitionAssessment(f, a.id, "submitted");
    await expectDenied(assessments.enterMarks(f, a.id, [{ studentId: sheet.rows[1].id, value: "9" }])); // locked
    await expectDenied(assessments.transitionAssessment(f, a.id, "approved")); // faculty cannot approve
    const hod = await ctxFor("faculty1@northbridge.test", "northbridge");
    await assessments.transitionAssessment(hod, a.id, "approved");
    await expectDenied(assessments.transitionAssessment(hod, a.id, "published")); // HOD cannot publish
    await assessments.transitionAssessment(A, a.id, "published");
    await expectDenied(assessments.transitionAssessment(A, a.id, "draft")); // reason required
    await assessments.transitionAssessment(A, a.id, "draft", "Totalling error");
    const log = await getDb().select().from(schema.auditLogs).where(and(eq(schema.auditLogs.entityId, a.id), eq(schema.auditLogs.action, "assessment.reopen")));
    expect(log[0].summary).toMatch(/Totalling error/);
  });
});

describe("attendance corrections", () => {
  it("requires an approver other than the requester and updates the record when approved", async () => {
    const f = await ctxFor("faculty2@northbridge.test", "northbridge");
    const sessions = await attendance.recentSessions(f, 1);
    const sess = sessions[0].session;
    const [rec] = await getDb().select().from(schema.attendanceRecords).where(eq(schema.attendanceRecords.sessionId, sess.id)).limit(1);
    // Locked after 48h: faculty cannot overwrite directly
    const sheet = await attendance.attendanceSheet(f, sess.classAssignmentId, sess.date, sess.period);
    await expectDenied(attendance.markAttendance(f, { classAssignmentId: sess.classAssignmentId, date: sess.date, period: sess.period, topic: null, statuses: Object.fromEntries(sheet.rows.map((r) => [r.id, "present"])) }));
    const to = rec.status === "present" ? "absent" : "present";
    const corr = await attendance.requestCorrection(f, { recordId: rec.id, toStatus: to, reason: "Marked wrongly in class" });
    const hod = await ctxFor("faculty1@northbridge.test", "northbridge");
    await attendance.reviewCorrection(hod, corr.id, "approved");
    const [after] = await getDb().select().from(schema.attendanceRecords).where(eq(schema.attendanceRecords.id, rec.id));
    expect(after.status).toBe(to);
    await expectDenied(attendance.reviewCorrection(hod, corr.id, "approved")); // already reviewed
  });

  it("refuses future-dated attendance", async () => {
    const f = await ctxFor("faculty2@northbridge.test", "northbridge");
    await expectDenied(attendance.markAttendance(f, { classAssignmentId: f.classes[0].id, date: "2999-01-01", period: 1, topic: null, statuses: {} }));
  });
});

describe("NFC card lifecycle", () => {
  it("public tap shows only configured public fields, never private data", async () => {
    const [c] = (await cards.listCards(A, { status: "active" })).filter((x) => x.card.studentId);
    const live = (await cards.liveTokenForCard(A, c.card.id))!;
    expect(live.token.length).toBeGreaterThanOrEqual(43);
    const view = await cards.resolveCardToken(live.token);
    expect(view.state).toBe("ok");
    if (view.state !== "ok") return;
    expect(Object.keys(view.fields).sort()).toEqual(["cardValidity", "department", "enrollmentNo", "fullName", "programme", "status"].sort());
    expect(JSON.stringify(view)).not.toMatch(/@northbridge\.test|guardian|address|\+91/i);
  });

  it("respects public-field configuration after publish", async () => {
    await settings.savePublicFields(A, ["fullName"]);
    A = await ctxFor("admin@northbridge.test", "northbridge");
    const [c] = await cards.listCards(A, { status: "active" });
    const view = await cards.resolveCardToken((await cards.liveTokenForCard(A, c.card.id))!.token);
    expect(view.state === "ok" && Object.keys(view.fields)).toEqual(["fullName"]);
  });

  it("shows extra details such as section and emergency contact only when the college enables them", async () => {
    await settings.savePublicFields(A, ["fullName", "section", "guardianPhone", "notAField"]);
    A = await ctxFor("admin@northbridge.test", "northbridge");
    const [c] = (await cards.listCards(A, { status: "active" })).filter((x) => x.card.studentId);
    const view = await cards.resolveCardToken((await cards.liveTokenForCard(A, c.card.id))!.token);
    expect(view.state).toBe("ok");
    if (view.state !== "ok") return;
    expect(Object.keys(view.fields).sort()).toEqual(["fullName", "guardianPhone", "section"]);
    expect(view.fields.section).toBeTruthy();
    expect(JSON.stringify(view)).not.toMatch(/@northbridge\.test|address/i);
    await settings.savePublicFields(A, ["fullName"]);
    A = await ctxFor("admin@northbridge.test", "northbridge");
  });

  it("rotation, deactivation, loss and replacement invalidate old URLs and keep the student link", async () => {
    const [c] = await cards.listCards(A, { status: "active" });
    const studentId = c.card.studentId!;
    const t1 = (await cards.liveTokenForCard(A, c.card.id))!.token;
    const r = await cards.rotateCardToken(A, c.card.id);
    expect((await cards.resolveCardToken(t1)).state).toBe("invalid");
    expect((await cards.resolveCardToken(r.token)).state).toBe("ok");

    await cards.setCardActive(A, c.card.id, false);
    expect((await cards.resolveCardToken(r.token)).state).toBe("inactive");
    await cards.setCardActive(A, c.card.id, true);

    const [spare] = await cards.unassignedCards(A);
    const rep = await cards.replaceCard(A, c.card.id, spare.id, "lost");
    expect((await cards.resolveCardToken(r.token)).state).toBe("invalid");
    const v = await cards.resolveCardToken(rep.token);
    expect(v.state === "ok" && v.studentId).toBe(studentId);
    const hist = await cards.cardHistory(A, c.card.id);
    expect(hist.map((h) => h.event.action)).toEqual(expect.arrayContaining(["registered", "assigned", "token_rotated", "deactivated", "activated", "reported_lost"]));
    await expectDenied(cards.setCardActive(A, c.card.id, true)); // retired cards stay retired
  });

  it("prevents two live cards for one student and rejects garbage tokens", async () => {
    const [c] = await cards.listCards(A, { status: "active" });
    const [spare] = await cards.unassignedCards(A);
    await expectDenied(cards.assignCard(A, spare.id, c.card.studentId!, null));
    expect((await cards.resolveCardToken("short")).state).toBe("invalid");
    expect((await cards.resolveCardToken("A".repeat(43))).state).toBe("invalid");
  });

  it("cards of a suspended college stop resolving", async () => {
    const [c] = await cards.listCards(B, { status: "active" });
    const t = (await cards.liveTokenForCard(B, c.card.id))!.token;
    const [sa] = await getDb().select().from(schema.users).where(eq(schema.users.email, "platform@mysmartcard.test"));
    await setInstitutionStatus(sa, B.institution.id, "suspended", "billing");
    expect((await cards.resolveCardToken(t)).state).toBe("inactive");
    await setInstitutionStatus(sa, B.institution.id, "active", "resolved");
  });
});

describe("platform college management", () => {
  it("lets only the super admin edit college details and see usage counts", async () => {
    const [sa] = await getDb().select().from(schema.users).where(eq(schema.users.email, "platform@mysmartcard.test"));
    const { usage } = await getInstitution(sa, B.institution.id);
    expect(usage.students).toBe(4);
    expect(usage.activeCards).toBeGreaterThan(0);
    const updated = await updateInstitutionDetails(sa, B.institution.id, { name: "Riverside College of Arts", shortName: "RCA", city: "Pune", contactEmail: null });
    expect(updated.name).toBe("Riverside College of Arts");
    expect(updated.slug).toBe(B.institution.slug);
    const [admin] = await getDb().select().from(schema.users).where(eq(schema.users.email, "admin@riverside.test"));
    await expectDenied(updateInstitutionDetails(admin, B.institution.id, { name: "Hijacked", shortName: "HJ" }));
  });
});

describe("student portal configuration is enforced server-side", () => {
  it("a module hidden by the super admin cannot be loaded even by direct request", async () => {
    const [sa] = await getDb().select().from(schema.users).where(eq(schema.users.email, "platform@mysmartcard.test"));
    let st = await ctxFor("student1@northbridge.test", "northbridge");
    expect(await portal.loadModule(await portal.viewerForStudent(st), "library")).toBeTruthy();
    await builder.saveCollegeDraft(sa, A.institution.id, { modules: { library: { enabled: false } }, features: {} });
    // Draft only: students still see the library
    st = await ctxFor("student1@northbridge.test", "northbridge");
    expect(await portal.loadModule(await portal.viewerForStudent(st), "library")).toBeTruthy();
    // The super-admin draft preview reflects it immediately
    const pv = await loadTenantContext(sa, "northbridge");
    await expectDenied(portal.loadModule(await portal.viewerForPlatformPreview(pv, st.studentId!, pv.draftConfig), "library"));
    await builder.publishCollege(sa, A.institution.id);
    st = await ctxFor("student1@northbridge.test", "northbridge");
    await expectDenied(portal.loadModule(await portal.viewerForStudent(st), "library"));
    expect(portal.visibleModules(await portal.viewerForStudent(st), (await portal.portalStudent(await portal.viewerForStudent(st))).student)).not.toContain("library");
    // Restore
    await builder.saveCollegeDraft(sa, A.institution.id, { modules: {}, features: {} });
    await builder.publishCollege(sa, A.institution.id);
    A = await ctxFor("admin@northbridge.test", "northbridge");
  });

  it("staff cannot use the student viewer and students cannot preview", async () => {
    await expectDenied(portal.viewerForStudent(A));
    const st = await ctxFor("student1@northbridge.test", "northbridge");
    await expectDenied(portal.viewerForPreview(st, aStudentId));
  });

  it("students only see notices targeted at them", async () => {
    const st = await ctxFor("student1@northbridge.test", "northbridge");
    const me = (await portal.portalStudent(await portal.viewerForStudent(st))).student;
    const otherDept = (await getDb().select().from(schema.departments).where(eq(schema.departments.institutionId, A.institution.id))).find((d) => d.id !== me.departmentId)!;
    await notices.createNotice(A, { title: "Only other dept", body: "x", category: "department", pinned: false, publishAt: null, expiresAt: null, publish: true, notifyEmail: false, audience: { scope: "targeted", departmentIds: [otherDept.id] } });
    await notices.createNotice(A, { title: "Future notice", body: "x", category: "general", pinned: false, publishAt: new Date(Date.now() + 864e5), expiresAt: null, publish: true, notifyEmail: false, audience: { scope: "all" } });
    const list = await notices.noticesForStudent(st, me);
    const titles = list.map((n) => n.title);
    expect(titles).not.toContain("Only other dept");
    expect(titles).not.toContain("Future notice");
    expect(titles).not.toContain("Draft: sports day volunteers");
    expect(titles).toContain("End-semester examination schedule released");
  });
});

describe("aggregate counts (correlated subqueries)", () => {
  it("platform college list counts each college's own rows", async () => {
    const { listInstitutions } = await import("@/server/services/platform");
    const [sa] = await getDb().select().from(schema.users).where(eq(schema.users.email, "platform@mysmartcard.test"));
    const rows = await listInstitutions(sa);
    const nb = rows.find((r) => r.inst.slug === "northbridge")!;
    const rv = rows.find((r) => r.inst.slug === "riverside")!;
    expect(nb.studentCount).toBe((await students.listStudents(A, {})).total);
    expect(rv.facultyCount).toBe(2);
    expect(nb.activeCards).toBe((await cards.cardCounts(A)).active);
  });
  it("transport riders, notice attachments, library loans and fee balances are computed per row", async () => {
    const { listRoutes } = await import("@/server/services/transport");
    const routes = await listRoutes(A);
    expect(routes[0].riders).toBe(6);
    const books = await library.listBooks(A);
    expect(books.filter((b) => b.onLoanTo).length).toBe((await library.activeLoans(A)).filter((l) => !l.loan.returnedAt).length);
    const ov = await finance.feeOverview(A);
    const top = ov.defaulters[0];
    expect(top.balance).toBe((await finance.studentLedger(A, top.id)).balance);
    const n = (await notices.adminNotices(A)).every((x) => x.attachments === 0);
    expect(n).toBe(true);
  });
});

describe("fees, library, timetable, import", () => {
  it("issues sequential unique receipt numbers and refuses card numbers in references", async () => {
    const p1 = await finance.recordPayment(A, { studentId: aStudentId, demandId: null, amount: 1000, method: "cash", reference: null, paidAt: new Date() });
    const p2 = await finance.recordPayment(A, { studentId: aStudentId, demandId: null, amount: 1000, method: "upi", reference: "UTR123", paidAt: new Date() });
    expect(p1.receiptNo).not.toBe(p2.receiptNo);
    expect(Number(p2.receiptNo.split("-").pop())).toBe(Number(p1.receiptNo.split("-").pop()) + 1);
    await expectDenied(finance.recordPayment(A, { studentId: aStudentId, demandId: null, amount: 1000, method: "card_pos", reference: "4111 1111 1111 1111", paidAt: new Date() }));
    const st = await ctxFor("student1@northbridge.test", "northbridge");
    const other = (await students.listStudents(A, { pageSize: 200 })).rows.find((r) => r.student.id !== st.studentId)!;
    const otherPay = (await finance.studentLedger(A, other.student.id)).payments[0];
    if (otherPay) await expectDenied(finance.receipt(st, otherPay.id));
  });

  it("enforces library loan limits and one active loan per copy", async () => {
    const loans = await library.activeLoans(A);
    const onLoan = loans[0];
    const anyStudent = (await students.listStudents(A, { pageSize: 200 })).rows.at(-1)!.student;
    await expectDenied(library.issueBook(A, { accessionNo: onLoan.accessionNo, enrollmentNo: anyStudent.enrollmentNo }));
    await library.returnBook(A, onLoan.loan.id);
    await expectDenied(library.returnBook(A, onLoan.loan.id));
  });

  it("detects timetable conflicts in the database", async () => {
    const tt = await timetable.timetableFor(A, {});
    const e = tt[0].entry;
    await expectDenied(timetable.addTimetableEntry(A, { sectionId: e.sectionId, subjectId: e.subjectId, facultyId: null, room: "ELSEWHERE", dayOfWeek: e.dayOfWeek, startTime: e.startTime, endTime: e.endTime }));
  });

  it("imports valid rows, reports invalid and duplicate rows, and is audited", async () => {
    const before = (await students.listStudents(B, {})).total;
    const existing = (await students.listStudents(B, {})).rows[0].student.enrollmentNo;
    const raw = [
      { enrollment_no: "RCASIMP001", full_name: "Imported One", email: "", department_code: "COM", programme_code: "BCOM", semester: "3", section: "A", academic_year: "2026-27", admission_year: "2025" },
      { enrollment_no: existing, full_name: "Dupe", email: "", department_code: "COM", programme_code: "BCOM", semester: "3", section: "", academic_year: "2026-27", admission_year: "" },
      { enrollment_no: "RCASIMP002", full_name: "Bad Dept", email: "", department_code: "XYZ", programme_code: "BCOM", semester: "3", section: "", academic_year: "2026-27", admission_year: "" },
    ];
    const res = await students.commitImport(B, raw as never, "test.csv");
    expect(res.imported).toBe(1);
    expect(res.issues).toHaveLength(2);
    expect((await students.listStudents(B, {})).total).toBe(before + 1);
    const audit = await getDb().select().from(schema.auditLogs).where(and(eq(schema.auditLogs.institutionId, B.institution.id), eq(schema.auditLogs.action, "student.import")));
    expect(audit).toHaveLength(1);
  });
});

describe("shared rate limiting & data retention", () => {
  it("counts across calls in the database and restarts after the window", async () => {
    await resetRateLimits();
    const r = [];
    for (let i = 0; i < 4; i++) r.push(await rateLimit("login:acct:x@test", 3, 60_000));
    expect(r.map((x) => x.ok)).toEqual([true, true, true, false]);
    expect(r[3].retryAfterSec).toBeGreaterThan(0);
    // Keys are hashed, never stored in clear.
    const rows = await getDb().select().from(schema.rateLimits);
    expect(rows.some((x) => x.key.includes("x@test"))).toBe(false);
    // Expire the window: the next call starts a fresh count.
    await getDb().update(schema.rateLimits).set({ resetAt: new Date(Date.now() - 1000) });
    expect((await rateLimit("login:acct:x@test", 3, 60_000)).ok).toBe(true);
  });

  it("removes only expired sessions, ended windows and old finished outbox rows", async () => {
    const u = await authenticate("admin@northbridge.test", DEMO_PASSWORD);
    const live = await createSession(u!.id, {});
    const dead = await createSession(u!.id, {});
    const { sha256 } = await import("@/lib/crypto");
    await getDb().update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.sessions.id, sha256(dead)));
    await getDb().update(schema.rateLimits).set({ resetAt: new Date(Date.now() - 1000) });
    const old = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    await getDb().insert(schema.notificationOutbox).values([
      { institutionId: A.institution.id, channel: "email", recipient: "a@test", subject: "old done", body: "-", status: "skipped_unconfigured", createdAt: old },
      { institutionId: A.institution.id, channel: "email", recipient: "a@test", subject: "old queued", body: "-", status: "queued", createdAt: old },
    ]);
    const res = await runRetention();
    expect(res.expiredSessions).toBeGreaterThanOrEqual(1);
    expect(res.rateLimitRows).toBeGreaterThanOrEqual(1);
    expect(res.outboxRows).toBe(1);
    expect(await userForSessionToken(live)).not.toBeNull();
    expect(await userForSessionToken(dead)).toBeNull();
    const left = await getDb().select().from(schema.notificationOutbox).where(eq(schema.notificationOutbox.subject, "old queued"));
    expect(left).toHaveLength(1);
  });
});
