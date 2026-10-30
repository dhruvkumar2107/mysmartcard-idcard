import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  date,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Every tenant-owned table carries `institution_id`. Application code never
 * accepts this value from the client: it is always taken from the resolved,
 * server-side tenant context (see src/server/context.ts).
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const tenant = () =>
  uuid("institution_id")
    .notNull()
    .references(() => institutions.id, { onDelete: "cascade" });

// ---------------------------------------------------------------- Platform

export const institutions = pgTable("institutions", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  city: text("city"),
  contactEmail: text("contact_email"),
  status: text("status").notNull().default("active"), // active | suspended
  plan: text("plan").notNull().default("standard"), // starter | standard | enterprise
  /** Modules the platform subscription allows. The college can only enable a subset. */
  licensedModules: jsonb("licensed_modules").$type<string[]>().notNull(),
  studentLimit: integer("student_limit").notNull().default(5000),
  createdAt: createdAt(),
});

export const institutionSettings = pgTable("institution_settings", {
  institutionId: uuid("institution_id")
    .primaryKey()
    .references(() => institutions.id, { onDelete: "cascade" }),
  draftConfig: jsonb("draft_config").notNull(),
  publishedConfig: jsonb("published_config").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  academic: jsonb("academic").notNull(), // attendance threshold, grade scale
  permissionOverrides: jsonb("permission_overrides").$type<Record<string, Record<string, boolean>>>().notNull().default({}),
  /** Super-admin portal policy for this college: only explicitly overridden keys (see src/lib/portal-config.ts). */
  policyDraft: jsonb("policy_draft").notNull().default({}),
  policyPublished: jsonb("policy_published").notNull().default({}),
  policyPublishedAt: timestamp("policy_published_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

/** Platform-wide key/value settings owned by the MySmartCard super admin (e.g. global portal defaults). */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
});

/** Versions of the super-admin portal policy. `institution_id` null = global defaults. */
export const portalPolicyHistory = pgTable(
  "portal_policy_history",
  {
    id: id(),
    institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // save_draft | publish | discard | rollback
    policy: jsonb("policy").notNull(),
    branding: jsonb("branding"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("pph_inst_idx").on(t.institutionId, t.createdAt)],
);

export const portalConfigHistory = pgTable(
  "portal_config_history",
  {
    id: id(),
    institutionId: tenant(),
    action: text("action").notNull(), // save_draft | publish | discard
    config: jsonb("config").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("pch_inst_idx").on(t.institutionId, t.createdAt)],
);

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  status: text("status").notNull().default("active"), // active | disabled
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    institutionId: tenant(),
    role: text("role").notNull(),
    departmentId: uuid("department_id").references((): AnyPgColumn => departments.id, { onDelete: "set null" }),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_user_inst_uq").on(t.userId, t.institutionId), index("memberships_inst_idx").on(t.institutionId)],
);

/**
 * Fixed-window rate-limit counters, shared by every app instance. `key` is a
 * sha256 of the bucket name so no emails or IPs are stored in clear.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("rate_limits_reset_idx").on(t.resetAt)],
);

/** Time-boxed, college-granted permission for a platform super admin to enter a workspace. */
export const supportGrants = pgTable("support_grants", {
  id: id(),
  institutionId: tenant(),
  grantedByUserId: uuid("granted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_inst_idx").on(t.institutionId, t.createdAt), index("audit_entity_idx").on(t.entityType, t.entityId)],
);

// ---------------------------------------------------------------- Academic structure

export const departments = pgTable(
  "departments",
  {
    id: id(),
    institutionId: tenant(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("departments_code_uq").on(t.institutionId, t.code)],
);

export const programmes = pgTable(
  "programmes",
  {
    id: id(),
    institutionId: tenant(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    durationSemesters: integer("duration_semesters").notNull().default(8),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("programmes_code_uq").on(t.institutionId, t.code)],
);

export const sections = pgTable(
  "sections",
  {
    id: id(),
    institutionId: tenant(),
    programmeId: uuid("programme_id")
      .notNull()
      .references(() => programmes.id, { onDelete: "restrict" }),
    semester: integer("semester").notNull(),
    name: text("name").notNull(),
    academicYear: text("academic_year").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sections_uq").on(t.institutionId, t.programmeId, t.semester, t.name, t.academicYear)],
);

export const subjects = pgTable(
  "subjects",
  {
    id: id(),
    institutionId: tenant(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    programmeId: uuid("programme_id").references(() => programmes.id, { onDelete: "set null" }),
    semester: integer("semester").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    credits: integer("credits").notNull().default(3),
    kind: text("kind").notNull().default("theory"), // theory | lab
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("subjects_code_uq").on(t.institutionId, t.code)],
);

// ---------------------------------------------------------------- People

export const faculty = pgTable(
  "faculty",
  {
    id: id(),
    institutionId: tenant(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    employeeCode: text("employee_code").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    designation: text("designation"),
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("faculty_code_uq").on(t.institutionId, t.employeeCode), index("faculty_user_idx").on(t.userId)],
);

export const students = pgTable(
  "students",
  {
    id: id(),
    institutionId: tenant(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    enrollmentNo: text("enrollment_no").notNull(),
    fullName: text("full_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"),
    guardianName: text("guardian_name"),
    guardianPhone: text("guardian_phone"),
    address: text("address"),
    bloodGroup: text("blood_group"),
    photoFileId: uuid("photo_file_id"),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    programmeId: uuid("programme_id").references(() => programmes.id, { onDelete: "set null" }),
    sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
    semester: integer("semester").notNull().default(1),
    academicYear: text("academic_year").notNull(),
    admissionYear: integer("admission_year"),
    status: text("status").notNull().default("active"), // active | inactive | suspended | graduated | archived
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("students_enrollment_uq").on(t.institutionId, t.enrollmentNo),
    index("students_inst_status_idx").on(t.institutionId, t.status),
    index("students_section_idx").on(t.sectionId),
    index("students_user_idx").on(t.userId),
  ],
);

/** A faculty member teaching a subject to a section. Basis for attendance & marks permissions. */
export const classAssignments = pgTable(
  "class_assignments",
  {
    id: id(),
    institutionId: tenant(),
    facultyId: uuid("faculty_id")
      .notNull()
      .references(() => faculty.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("class_assign_uq").on(t.facultyId, t.subjectId, t.sectionId)],
);

// ---------------------------------------------------------------- Attendance

export const attendanceSessions = pgTable(
  "attendance_sessions",
  {
    id: id(),
    institutionId: tenant(),
    classAssignmentId: uuid("class_assignment_id")
      .notNull()
      .references(() => classAssignments.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    period: integer("period").notNull().default(1),
    topic: text("topic"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("att_session_uq").on(t.classAssignmentId, t.date, t.period), index("att_session_section_idx").on(t.sectionId, t.date)],
);

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: id(),
    institutionId: tenant(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => attendanceSessions.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // present | absent | late | excused
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("att_record_uq").on(t.sessionId, t.studentId), index("att_record_student_idx").on(t.studentId)],
);

export const attendanceCorrections = pgTable("attendance_corrections", {
  id: id(),
  institutionId: tenant(),
  recordId: uuid("record_id")
    .notNull()
    .references(() => attendanceRecords.id, { onDelete: "cascade" }),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | rejected
  requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- Examinations & assessments

export const assessments = pgTable(
  "assessments",
  {
    id: id(),
    institutionId: tenant(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** internal | midterm | end_semester | practical | viva | class_test | assignment | project */
    category: text("category").notNull(),
    maxMarks: numeric("max_marks", { precision: 6, scale: 2, mode: "number" }).notNull(),
    examDate: date("exam_date"),
    startTime: text("start_time"),
    endTime: text("end_time"),
    room: text("room"),
    status: text("status").notNull().default("draft"), // draft | submitted | approved | published
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("assess_section_idx").on(t.institutionId, t.sectionId), index("assess_status_idx").on(t.institutionId, t.status)],
);

export const marks = pgTable(
  "marks",
  {
    id: id(),
    institutionId: tenant(),
    assessmentId: uuid("assessment_id")
      .notNull()
      .references(() => assessments.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    marksObtained: numeric("marks_obtained", { precision: 6, scale: 2, mode: "number" }),
    isAbsent: boolean("is_absent").notNull().default(false),
    remarks: text("remarks"),
    enteredByUserId: uuid("entered_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("marks_uq").on(t.assessmentId, t.studentId), index("marks_student_idx").on(t.studentId)],
);

// ---------------------------------------------------------------- Timetable & calendar

export const timetableEntries = pgTable(
  "timetable_entries",
  {
    id: id(),
    institutionId: tenant(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    facultyId: uuid("faculty_id").references(() => faculty.id, { onDelete: "set null" }),
    room: text("room").notNull(),
    dayOfWeek: integer("day_of_week").notNull(), // 1 = Monday … 6 = Saturday
    startTime: text("start_time").notNull(), // HH:MM
    endTime: text("end_time").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("tt_section_idx").on(t.institutionId, t.sectionId, t.dayOfWeek)],
);

/**
 * Uploaded timetable images. Each targeting column is optional: null means "any",
 * so a row with only a department applies to every semester and section of it.
 */
export const timetableImages = pgTable(
  "timetable_images",
  {
    id: id(),
    institutionId: tenant(),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("class"), // class | exam
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    programmeId: uuid("programme_id").references(() => programmes.id, { onDelete: "set null" }),
    semester: integer("semester"),
    sectionId: uuid("section_id").references(() => sections.id, { onDelete: "set null" }),
    academicYear: text("academic_year"),
    /** The current image; earlier versions stay in `files` (owner_type = timetable_image). */
    fileId: uuid("file_id").notNull(),
    status: text("status").notNull().default("draft"), // draft | published | archived
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tt_images_inst_idx").on(t.institutionId, t.status)],
);

export const calendarEvents = pgTable("calendar_events", {
  id: id(),
  institutionId: tenant(),
  title: text("title").notNull(),
  kind: text("kind").notNull(), // holiday | schedule_change | event | deadline
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  sectionId: uuid("section_id").references(() => sections.id, { onDelete: "cascade" }),
  description: text("description"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- Files

export const files = pgTable(
  "files",
  {
    id: id(),
    institutionId: tenant(),
    /** What the file belongs to. Download authorization is decided per owner type. */
    ownerType: text("owner_type").notNull(), // student_photo | student_document | notice | coursework | submission | branding | timetable_image
    ownerId: uuid("owner_id"),
    storageKey: text("storage_key").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    label: text("label"),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("files_owner_idx").on(t.institutionId, t.ownerType, t.ownerId)],
);

// ---------------------------------------------------------------- Notices

export type NoticeAudience = {
  scope: "all" | "targeted";
  departmentIds?: string[];
  programmeIds?: string[];
  semesters?: number[];
  sectionIds?: string[];
  studentIds?: string[];
};

export const notices = pgTable(
  "notices",
  {
    id: id(),
    institutionId: tenant(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category").notNull(), // general | department | class | exam | holiday | deadline | event | admin | transport | library
    pinned: boolean("pinned").notNull().default(false),
    status: text("status").notNull().default("draft"), // draft | published | archived
    publishAt: timestamp("publish_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    audience: jsonb("audience").$type<NoticeAudience>().notNull(),
    /** students | teachers — the two notice boards never mix. */
    audienceType: text("audience_type").notNull().default("students"),
    imageFileId: uuid("image_file_id"),
    imagePosition: text("image_position").notNull().default("center"), // top | center | bottom
    /** Bumped only for a "major update"; readers who read an older revision see it as unread again. */
    revision: integer("revision").notNull().default(1),
    notifyEmail: boolean("notify_email").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("notices_inst_idx").on(t.institutionId, t.status, t.publishAt)],
);

/** Per-user read receipts, so unread badges persist across sessions and devices. */
export const noticeReads = pgTable(
  "notice_reads",
  {
    id: id(),
    institutionId: tenant(),
    noticeId: uuid("notice_id")
      .notNull()
      .references(() => notices.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notice_reads_uq").on(t.noticeId, t.userId), index("notice_reads_user_idx").on(t.userId)],
);

export const notificationOutbox = pgTable("notification_outbox", {
  id: id(),
  institutionId: tenant(),
  channel: text("channel").notNull(), // email | push
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("queued"), // queued | sent | skipped_unconfigured | failed
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- Coursework

export const coursework = pgTable(
  "coursework",
  {
    id: id(),
    institutionId: tenant(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // assignment | material
    title: text("title").notNull(),
    instructions: text("instructions"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    maxMarks: integer("max_marks"),
    acceptSubmissions: boolean("accept_submissions").notNull().default(false),
    /** draft | published | archived. Existing rows default to published so nothing disappears. */
    status: text("status").notNull().default("published"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("coursework_section_idx").on(t.institutionId, t.sectionId)],
);

export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    institutionId: tenant(),
    courseworkId: uuid("coursework_id")
      .notNull()
      .references(() => coursework.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    note: text("note"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    grade: integer("grade"),
    feedback: text("feedback"),
    gradedByUserId: uuid("graded_by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("submission_uq").on(t.courseworkId, t.studentId)],
);

// ---------------------------------------------------------------- Fees (amounts in minor units, e.g. paise)

export const feeDemands = pgTable(
  "fee_demands",
  {
    id: id(),
    institutionId: tenant(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // tuition | exam | hostel | transport | library | lab | other
    description: text("description"),
    amount: integer("amount").notNull(),
    dueDate: date("due_date"),
    academicYear: text("academic_year").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("fee_demand_student_idx").on(t.institutionId, t.studentId)],
);

export const feePayments = pgTable(
  "fee_payments",
  {
    id: id(),
    institutionId: tenant(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    demandId: uuid("demand_id").references(() => feeDemands.id, { onDelete: "set null" }),
    amount: integer("amount").notNull(),
    method: text("method").notNull(), // cash | upi | bank_transfer | cheque | card_pos | gateway
    reference: text("reference"),
    receiptNo: text("receipt_no").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    reconciled: boolean("reconciled").notNull().default(false),
    reconciledByUserId: uuid("reconciled_by_user_id").references(() => users.id, { onDelete: "set null" }),
    recordedByUserId: uuid("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("fee_receipt_uq").on(t.institutionId, t.receiptNo), index("fee_payment_student_idx").on(t.institutionId, t.studentId)],
);

// ---------------------------------------------------------------- Library

export const libraryBooks = pgTable(
  "library_books",
  {
    id: id(),
    institutionId: tenant(),
    accessionNo: text("accession_no").notNull(),
    isbn: text("isbn"),
    title: text("title").notNull(),
    author: text("author"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("library_accession_uq").on(t.institutionId, t.accessionNo)],
);

export const libraryLoans = pgTable(
  "library_loans",
  {
    id: id(),
    institutionId: tenant(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => libraryBooks.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    issuedAt: date("issued_at").notNull(),
    dueAt: date("due_at").notNull(),
    returnedAt: date("returned_at"),
    renewals: integer("renewals").notNull().default(0),
    fineAmount: integer("fine_amount").notNull().default(0),
    finePaid: boolean("fine_paid").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("loan_student_idx").on(t.institutionId, t.studentId), index("loan_book_idx").on(t.bookId)],
);

// ---------------------------------------------------------------- Transport

export const transportRoutes = pgTable(
  "transport_routes",
  {
    id: id(),
    institutionId: tenant(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    vehicleNo: text("vehicle_no"),
    driverName: text("driver_name"),
    contactPhone: text("contact_phone"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("route_code_uq").on(t.institutionId, t.code)],
);

export const transportStops = pgTable("transport_stops", {
  id: id(),
  institutionId: tenant(),
  routeId: uuid("route_id")
    .notNull()
    .references(() => transportRoutes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sequence: integer("sequence").notNull(),
  pickupTime: text("pickup_time").notNull(),
  dropTime: text("drop_time").notNull(),
});

export const transportAssignments = pgTable(
  "transport_assignments",
  {
    id: id(),
    institutionId: tenant(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => transportRoutes.id, { onDelete: "cascade" }),
    stopId: uuid("stop_id").references(() => transportStops.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("transport_student_uq").on(t.studentId)],
);

// ---------------------------------------------------------------- NFC cards

export const nfcCards = pgTable(
  "nfc_cards",
  {
    id: id(),
    institutionId: tenant(),
    /** Printed serial / chip UID. Never contains student data. */
    serial: text("serial").notNull(),
    status: text("status").notNull().default("unassigned"), // unassigned | active | inactive | lost | damaged | revoked
    studentId: uuid("student_id").references(() => students.id, { onDelete: "set null" }),
    validUntil: date("valid_until"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("nfc_serial_uq").on(t.institutionId, t.serial), index("nfc_student_idx").on(t.studentId)],
);

export const cardTokens = pgTable(
  "card_tokens",
  {
    id: id(),
    institutionId: tenant(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => nfcCards.id, { onDelete: "cascade" }),
    /** sha256(token): used for lookup, so a DB leak does not reveal live URLs. */
    tokenHash: text("token_hash").notNull().unique(),
    /** AES-256-GCM encrypted token, so admins can re-print the QR fallback / re-encode the tag. */
    tokenEncrypted: text("token_encrypted").notNull(),
    status: text("status").notNull().default("active"), // active | revoked
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
    lastTappedAt: timestamp("last_tapped_at", { withTimezone: true }),
    tapCount: integer("tap_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("card_tokens_card_idx").on(t.cardId)],
);

export const cardEvents = pgTable(
  "card_events",
  {
    id: id(),
    institutionId: tenant(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => nfcCards.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").references(() => students.id, { onDelete: "set null" }),
    action: text("action").notNull(), // registered | assigned | activated | deactivated | reported_lost | reported_damaged | replaced | token_rotated | revoked | unassigned
    notes: text("notes"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("card_events_card_idx").on(t.cardId, t.createdAt)],
);
