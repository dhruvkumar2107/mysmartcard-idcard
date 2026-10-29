/**
 * Fictional demo data. All names, numbers and institutions are invented.
 * Seeding goes through the real service layer so business rules, tenant
 * scoping and audit logging are exercised exactly as in production.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, students as studentsTable, attendanceSessions } from "@/db/schema";
import { hashPassword } from "@/server/auth";
import { loadTenantContext, type TenantContext } from "@/server/context";
import { createInstitution } from "@/server/services/platform";
import * as academics from "@/server/services/academics";
import * as people from "@/server/services/people";
import * as studentsSvc from "@/server/services/students";
import * as attendance from "@/server/services/attendance";
import * as assessments from "@/server/services/assessments";
import * as timetable from "@/server/services/timetable";
import * as notices from "@/server/services/notices";
import * as coursework from "@/server/services/coursework";
import * as finance from "@/server/services/finance";
import * as library from "@/server/services/library";
import * as transport from "@/server/services/transport";
import * as cards from "@/server/services/cards";
import { MODULE_KEYS } from "@/lib/portal-config";
import { addDaysISO, todayISO } from "@/lib/format";

export const DEMO_PASSWORD = "Demo@12345";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const FIRST = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Ananya", "Vihaan", "Isha", "Arjun", "Saanvi", "Reyansh", "Tara", "Aditya", "Kiara", "Dhruv", "Myra", "Ishaan", "Navya", "Krish", "Zara", "Om", "Riya", "Yash", "Pari"];
const LAST = ["Sharma", "Iyer", "Khan", "Reddy", "Patel", "Menon", "Das", "Gill", "Nair", "Joshi", "Bose", "Rao", "Kapoor", "Singh", "Verma", "Pillai"];

async function setPassword(email: string) {
  await getDb().update(users).set({ passwordHash: await hashPassword(DEMO_PASSWORD), mustChangePassword: false }).where(eq(users.email, email));
}

async function ensureSuperAdmin() {
  const [existing] = await getDb().select().from(users).where(eq(users.email, "platform@mysmartcard.test"));
  if (existing) return existing;
  const [u] = await getDb()
    .insert(users)
    .values({ email: "platform@mysmartcard.test", name: "Platform Operator", passwordHash: await hashPassword(DEMO_PASSWORD), isSuperAdmin: true })
    .returning();
  return u;
}

async function ctxFor(email: string, slug: string): Promise<TenantContext> {
  const [u] = await getDb().select().from(users).where(eq(users.email, email));
  return loadTenantContext(u, slug);
}

type CollegeSpec = {
  slug: string;
  name: string;
  shortName: string;
  city: string;
  domain: string;
  seed: number;
  departments: { code: string; name: string; programme: { code: string; name: string }; subjects: { code: string; name: string; credits: number; kind: "theory" | "lab" }[] }[];
  studentsPerSection: number;
  rich: boolean;
};

export async function seedCollege(spec: CollegeSpec) {
  const rand = rng(spec.seed);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const superAdmin = await ensureSuperAdmin();
  const adminEmail = `admin@${spec.domain}`;
  await createInstitution(superAdmin, {
    name: spec.name,
    shortName: spec.shortName,
    slug: spec.slug,
    city: spec.city,
    contactEmail: `office@${spec.domain}`,
    plan: spec.rich ? "enterprise" : "standard",
    licensedModules: MODULE_KEYS,
    studentLimit: 5000,
    adminName: `${spec.shortName} Administrator`,
    adminEmail,
  });
  await setPassword(adminEmail);
  let admin = await ctxFor(adminEmail, spec.slug);

  const year = "2026-27";
  const sem = 3;
  const deptRows = [];
  for (const d of spec.departments) {
    const dep = await academics.createDepartment(admin, { code: d.code, name: d.name });
    const prog = await academics.createProgramme(admin, { departmentId: dep.id, code: d.programme.code, name: d.programme.name, durationSemesters: 8 });
    const secA = await academics.createSection(admin, { programmeId: prog.id, semester: sem, name: "A", academicYear: year });
    const subs = [];
    for (const s of d.subjects) subs.push(await academics.createSubject(admin, { departmentId: dep.id, programmeId: prog.id, semester: sem, ...s }));
    deptRows.push({ dep, prog, secA, subs });
  }

  // Faculty — one per subject, first department's first faculty is HOD.
  const facultyRows: { f: Awaited<ReturnType<typeof people.createFaculty>>; email: string }[] = [];
  const facultyBySubject = new Map<string, string>();
  let fi = 1;
  for (const d of deptRows) {
    for (const s of d.subs) {
      const name = `Dr. ${pick(FIRST)} ${pick(LAST)}`;
      const email = `faculty${fi}@${spec.domain}`;
      const f = await people.createFaculty(admin, { employeeCode: `${spec.shortName}-F${String(fi).padStart(3, "0")}`, name, email, phone: `+91 90000 ${String(10000 + fi).slice(-5)}`, designation: fi % 3 === 1 ? "Associate Professor" : "Assistant Professor", departmentId: d.dep.id });
      await academics.assignClass(admin, { facultyId: f.id, subjectId: s.id, sectionId: d.secA.id });
      facultyBySubject.set(s.id, f.id);
      facultyRows.push({ f, email });
      fi++;
    }
  }
  await people.grantStaffAccess(admin, facultyRows[0].f.id, "hod");
  await setPassword(facultyRows[0].email);
  for (const r of facultyRows.slice(1, 3)) {
    await people.grantStaffAccess(admin, r.f.id, "faculty");
    await setPassword(r.email);
  }
  if (spec.rich) {
    for (const [role, label] of [["principal", "Principal"], ["accountant", "Accounts Officer"], ["librarian", "Librarian"], ["transport_admin", "Transport Office"]] as const) {
      const email = `${role.replace("_", "")}@${spec.domain}`;
      await people.createStaffUser(admin, { name: `${label} (${spec.shortName})`, email, role, departmentId: null });
      await setPassword(email);
    }
  }
  admin = await ctxFor(adminEmail, spec.slug);

  // Students
  const allStudents: { id: string; enrollmentNo: string; sectionId: string }[] = [];
  let n = 1;
  for (const d of deptRows) {
    for (let i = 0; i < spec.studentsPerSection; i++) {
      const fullName = `${pick(FIRST)} ${pick(LAST)}`;
      const enrollmentNo = `${spec.shortName}${d.dep.code}25${String(n).padStart(3, "0")}`;
      const s = await studentsSvc.createStudent(admin, {
        enrollmentNo,
        fullName,
        email: `student${n}@${spec.domain}`,
        phone: `+91 98${String(10000000 + n * 7919).slice(-8)}`,
        dateOfBirth: `2006-${String((n % 12) + 1).padStart(2, "0")}-${String((n % 27) + 1).padStart(2, "0")}`,
        gender: n % 2 ? "Female" : "Male",
        guardianName: `${pick(FIRST)} ${fullName.split(" ")[1]}`,
        guardianPhone: `+91 97${String(20000000 + n * 104729).slice(-8)}`,
        address: `${10 + n}, ${pick(["Lake View Road", "Station Road", "MG Road", "Park Street"])}, ${spec.city}`,
        bloodGroup: pick(["A+", "B+", "O+", "AB+", "O-"]),
        departmentId: d.dep.id,
        programmeId: d.prog.id,
        sectionId: d.secA.id,
        semester: sem,
        academicYear: year,
        admissionYear: 2025,
        status: "active",
      });
      allStudents.push({ id: s.id, enrollmentNo, sectionId: d.secA.id });
      n++;
    }
  }
  // Portal accounts for the first two students of each college.
  for (const s of allStudents.slice(0, 2)) {
    const res = await studentsSvc.enablePortalAccess(admin, s.id);
    await setPassword(res.email);
  }

  // Timetable: Mon–Fri, one subject per slot, rooms per department.
  const times = [["09:00", "09:55"], ["10:00", "10:55"], ["11:10", "12:05"], ["13:00", "14:50"]];
  for (const [di, d] of deptRows.entries()) {
    for (let day = 1; day <= 5; day++) {
      for (let p = 0; p < Math.min(times.length, d.subs.length); p++) {
        const subj = d.subs[(p + day) % d.subs.length];
        await timetable.addTimetableEntry(admin, { sectionId: d.secA.id, subjectId: subj.id, facultyId: facultyBySubject.get(subj.id)!, room: subj.kind === "lab" ? `${d.dep.code}-LAB${di + 1}` : `${d.dep.code}-${100 + day}`, dayOfWeek: day, startTime: times[p][0], endTime: times[p][1] });
      }
    }
  }

  // Attendance for the last 15 weekdays.
  const classes = await academics.listClassAssignments(admin);
  const today = todayISO();
  let dayOffset = 1;
  let marked = 0;
  while (marked < 15) {
    const date = addDaysISO(today, -dayOffset++);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    marked++;
    for (const c of classes) {
      const roster = await attendance.rosterForSection(admin, c.sectionId);
      const statuses = Object.fromEntries(roster.map((r, i) => [r.id, (rand() < (i % 5 === 0 ? 0.35 : 0.1) ? "absent" : rand() < 0.05 ? "late" : "present") as "absent" | "late" | "present"]));
      await attendance.markAttendance(admin, { classAssignmentId: c.id, date, period: 1, topic: null, statuses });
    }
  }
  // Backdate session creation so the 48h edit lock behaves realistically.
  await getDb().update(attendanceSessions).set({ createdAt: new Date(Date.now() - 3 * 86400000) }).where(eq(attendanceSessions.institutionId, admin.institution.id));

  // Assessments: internal + practical published, midterm submitted (awaiting approval), end-sem scheduled.
  for (const c of classes) {
    const roster = await attendance.rosterForSection(admin, c.sectionId);
    const mk = async (name: string, category: string, max: number, examDate: string | null, publish: boolean | "submitted") => {
      const a = await assessments.createAssessment(admin, { subjectId: c.subjectId, sectionId: c.sectionId, name, category: category as never, maxMarks: max, examDate, startTime: examDate ? "10:00" : null, endTime: examDate ? "13:00" : null, room: examDate ? "Exam Hall 1" : null });
      if (examDate && examDate > today) return;
      await assessments.enterMarks(admin, a.id, roster.map((r, i) => ({ studentId: r.id, value: i % 11 === 7 ? "AB" : String(Math.round(max * (0.45 + rand() * 0.53))) })));
      await assessments.transitionAssessment(admin, a.id, "submitted");
      if (publish === "submitted") return;
      await assessments.transitionAssessment(admin, a.id, "approved");
      if (publish) await assessments.transitionAssessment(admin, a.id, "published");
    };
    await mk("Internal Test 1", "internal", 30, addDaysISO(today, -20), true);
    if (c.subjectKind === "lab") await mk("Lab Practical 1", "practical", 50, addDaysISO(today, -10), true);
    else await mk("Class Test 2", "class_test", 20, addDaysISO(today, -8), true);
    await mk("Viva", "viva", 10, addDaysISO(today, -5), true);
    await mk("Midterm Examination", "midterm", 50, addDaysISO(today, -3), "submitted");
    await mk("End-Semester Examination", "end_semester", 100, addDaysISO(today, 30 + (classes.indexOf(c) % 5) * 2), false);
  }

  // Calendar
  await timetable.addCalendarEvent(admin, { title: "Founders' Day — campus closed", kind: "holiday", startDate: addDaysISO(today, 9), endDate: null, sectionId: null, description: null });
  await timetable.addCalendarEvent(admin, { title: "Saturday classes follow Monday timetable", kind: "schedule_change", startDate: addDaysISO(today, 4), endDate: null, sectionId: null, description: "Compensatory working day." });

  // Notices
  await notices.createNotice(admin, { title: "End-semester examination schedule released", body: "The end-semester examination timetable is now available in the Timetable section. Students must carry their ID card to the examination hall.", category: "exam", pinned: true, publishAt: null, expiresAt: null, publish: true, notifyEmail: false, audience: { scope: "all" } });
  await notices.createNotice(admin, { title: `${deptRows[0].dep.code} department seminar on Friday`, body: "Guest lecture on applied research methods at 3 PM in the seminar hall. Attendance is encouraged.", category: "department", pinned: false, publishAt: null, expiresAt: null, publish: true, notifyEmail: false, audience: { scope: "targeted", departmentIds: [deptRows[0].dep.id] } });
  await notices.createNotice(admin, { title: "Bus route timings revised from Monday", body: "Morning pickups on all routes move 10 minutes earlier due to road works.", category: "transport", pinned: false, publishAt: null, expiresAt: null, publish: true, notifyEmail: false, audience: { scope: "all" } });
  await notices.createNotice(admin, { title: "Library extended hours during exams", body: "The central library will remain open until 10 PM during the examination period.", category: "library", pinned: false, publishAt: null, expiresAt: null, publish: true, notifyEmail: false, audience: { scope: "all" } });
  await notices.createNotice(admin, { title: "Draft: sports day volunteers", body: "Draft notice — not visible to students until published.", category: "event", pinned: false, publishAt: null, expiresAt: null, publish: false, notifyEmail: false, audience: { scope: "all" } });

  // Coursework
  for (const c of classes.slice(0, 3)) {
    await coursework.createCoursework(admin, { subjectId: c.subjectId, sectionId: c.sectionId, kind: "assignment", title: `${c.subjectCode} Problem Set 3`, instructions: "Solve all questions. Submit a single PDF.", dueAt: new Date(Date.now() + 6 * 86400000), maxMarks: 20, acceptSubmissions: true });
    await coursework.createCoursework(admin, { subjectId: c.subjectId, sectionId: c.sectionId, kind: "material", title: `${c.subjectCode} Unit 2 lecture notes`, instructions: "Read chapters 4–5 before next week's class.", dueAt: null, maxMarks: null, acceptSubmissions: false });
  }

  // Fees
  for (const [i, s] of allStudents.entries()) {
    const tuition = await finance.addFeeDemand(admin, { studentId: s.id, category: "tuition", description: "Semester 3 tuition", amount: 6250000, dueDate: addDaysISO(today, -15), academicYear: year });
    await finance.addFeeDemand(admin, { studentId: s.id, category: "exam", description: "End-semester examination fee", amount: 250000, dueDate: addDaysISO(today, 20), academicYear: year });
    if (i % 4 !== 3) await finance.recordPayment(admin, { studentId: s.id, demandId: tuition.id, amount: i % 4 === 2 ? 3000000 : 6250000, method: i % 2 ? "upi" : "bank_transfer", reference: `UTR${String(880000 + i * 37)}`, paidAt: new Date(Date.now() - (20 - (i % 10)) * 86400000) });
  }

  // Library
  const books = [
    ["Introduction to Algorithms", "Cormen, Leiserson, Rivest, Stein"],
    ["Signals and Systems", "Oppenheim & Willsky"],
    ["Database System Concepts", "Silberschatz, Korth, Sudarshan"],
    ["Engineering Mathematics", "B. S. Grewal"],
    ["Computer Networks", "Tanenbaum & Wetherall"],
    ["Digital Design", "Morris Mano"],
  ];
  for (const [i, [title, author]] of books.entries()) await library.addBook(admin, { accessionNo: `ACC${1000 + i}`, isbn: null, title, author });
  for (const [i, s] of allStudents.slice(0, 4).entries()) await library.issueBook(admin, { accessionNo: `ACC${1000 + i}`, enrollmentNo: s.enrollmentNo });

  // Transport
  const r1 = await transport.createRoute(admin, { code: "R1", name: `${spec.city} Central – Campus`, vehicleNo: "KA-01-AB-1234", driverName: "R. Kumar", contactPhone: "+91 80000 11111" });
  const stops = [];
  for (const [i, [name, pick_, drop]] of [["Central Bus Stand", "07:20", "17:45"], ["Clock Tower", "07:35", "17:30"], ["Tech Park Gate", "07:50", "17:15"]].entries())
    stops.push(await transport.addStop(admin, { routeId: r1.id, name, sequence: i + 1, pickupTime: pick_, dropTime: drop }));
  for (const [i, s] of allStudents.slice(0, 6).entries()) await transport.assignTransport(admin, { enrollmentNo: s.enrollmentNo, routeId: r1.id, stopId: stops[i % stops.length].id });

  // NFC cards
  const serials = Array.from({ length: allStudents.length + 5 }, (_, i) => `${spec.shortName}-NFC-${String(i + 1).padStart(5, "0")}`);
  await cards.registerCards(admin, serials);
  const pool = await cards.unassignedCards(admin);
  const tokens: { enrollmentNo: string; url: string }[] = [];
  for (const [i, s] of allStudents.entries()) {
    const res = await cards.assignCard(admin, pool[i].id, s.id, `${new Date().getFullYear() + 1}-06-30`);
    tokens.push({ enrollmentNo: s.enrollmentNo, url: res.url });
  }

  const firstStudentEmail = (await getDb().select({ e: studentsTable.email }).from(studentsTable).where(eq(studentsTable.id, allStudents[0].id)))[0].e;
  return { slug: spec.slug, adminEmail, hodEmail: facultyRows[0].email, facultyEmail: facultyRows[1].email, studentEmail: firstStudentEmail, sampleCard: tokens[0] };
}

export const COLLEGES: CollegeSpec[] = [
  {
    slug: "northbridge",
    name: "Northbridge Institute of Technology",
    shortName: "NIT",
    city: "Bengaluru",
    domain: "northbridge.test",
    seed: 42,
    studentsPerSection: 14,
    rich: true,
    departments: [
      {
        code: "CSE",
        name: "Computer Science & Engineering",
        programme: { code: "BTECH-CSE", name: "B.Tech Computer Science & Engineering" },
        subjects: [
          { code: "CS301", name: "Data Structures & Algorithms", credits: 4, kind: "theory" },
          { code: "CS302", name: "Database Management Systems", credits: 3, kind: "theory" },
          { code: "CS303L", name: "DBMS Laboratory", credits: 2, kind: "lab" },
        ],
      },
      {
        code: "ECE",
        name: "Electronics & Communication Engineering",
        programme: { code: "BTECH-ECE", name: "B.Tech Electronics & Communication" },
        subjects: [
          { code: "EC301", name: "Signals & Systems", credits: 4, kind: "theory" },
          { code: "EC302L", name: "Digital Electronics Lab", credits: 2, kind: "lab" },
        ],
      },
    ],
  },
  {
    slug: "riverside",
    name: "Riverside College of Arts & Science",
    shortName: "RCAS",
    city: "Kochi",
    domain: "riverside.test",
    seed: 7,
    studentsPerSection: 8,
    rich: false,
    departments: [
      {
        code: "COM",
        name: "Commerce",
        programme: { code: "BCOM", name: "Bachelor of Commerce" },
        subjects: [
          { code: "BC301", name: "Financial Accounting", credits: 4, kind: "theory" },
          { code: "BC302", name: "Business Statistics", credits: 3, kind: "theory" },
        ],
      },
    ],
  },
];
