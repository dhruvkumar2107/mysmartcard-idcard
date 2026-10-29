/**
 * Role → permission matrix (least privilege). Colleges may override grants for
 * non-admin roles through the Portal Designer → Roles tab; `college_admin`
 * cannot be reduced so a college can never lock itself out.
 */

export const ROLES = [
  "college_admin",
  "principal",
  "hod",
  "faculty",
  "accountant",
  "librarian",
  "transport_admin",
  "student",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  college_admin: "College Administrator",
  principal: "Principal / Academic Admin",
  hod: "Head of Department",
  faculty: "Faculty Member",
  accountant: "Accounts Officer",
  librarian: "Librarian",
  transport_admin: "Transport Administrator",
  student: "Student",
};

export const PERMISSIONS = {
  "dashboard.view": "View admin dashboard",
  "reports.view": "View institution reports",
  "students.view": "View student records (within scope)",
  "students.view_sensitive": "View sensitive student fields (DOB, address, guardian)",
  "students.edit": "Create and edit students",
  "students.archive": "Archive / restore students",
  "students.import": "Import students (CSV/XLSX)",
  "students.export": "Export student data",
  "students.portal_access": "Manage student portal accounts",
  "faculty.view": "View faculty",
  "faculty.edit": "Manage faculty",
  "academics.manage": "Manage departments, programmes, sections, subjects, teaching assignments",
  "attendance.mark": "Mark attendance for assigned classes",
  "attendance.view_all": "View attendance across scope",
  "attendance.approve": "Approve attendance corrections",
  "assessments.manage": "Create assessments for assigned classes",
  "marks.enter": "Enter marks for assigned classes",
  "results.approve": "Approve submitted marks",
  "results.publish": "Publish / reopen results",
  "timetable.manage": "Manage timetable and academic calendar",
  "notices.publish": "Publish notices",
  "coursework.manage": "Publish assignments & study material for assigned classes",
  "fees.view": "View fee records",
  "fees.manage": "Record fee demands and payments",
  "library.manage": "Manage library records",
  "transport.manage": "Manage transport routes & assignments",
  "cards.manage": "Manage NFC cards",
  "portal.configure": "Configure student portal",
  "users.manage": "Manage staff accounts & roles",
  "audit.view": "View audit logs",
  "support.grant": "Grant platform support access",
} as const;
export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  college_admin: ALL,
  principal: [
    "dashboard.view",
    "reports.view",
    "students.view",
    "students.view_sensitive",
    "students.export",
    "faculty.view",
    "attendance.view_all",
    "attendance.approve",
    "results.approve",
    "results.publish",
    "timetable.manage",
    "notices.publish",
    "fees.view",
    "audit.view",
  ],
  hod: [
    "dashboard.view",
    "reports.view",
    "students.view",
    "faculty.view",
    "attendance.view_all",
    "attendance.approve",
    "attendance.mark",
    "assessments.manage",
    "marks.enter",
    "results.approve",
    "notices.publish",
    "coursework.manage",
  ],
  faculty: ["dashboard.view", "students.view", "attendance.mark", "assessments.manage", "marks.enter", "coursework.manage"],
  accountant: ["dashboard.view", "students.view", "fees.view", "fees.manage"],
  librarian: ["dashboard.view", "students.view", "library.manage"],
  transport_admin: ["dashboard.view", "students.view", "transport.manage", "notices.publish"],
  student: [],
};

/** Permissions a college may never grant to a role, regardless of overrides. */
const NEVER_GRANTABLE: Partial<Record<Role, Permission[]>> = {
  student: ALL,
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function resolvePermissions(role: Role, overrides?: Record<string, Record<string, boolean>>): Set<Permission> {
  const granted = new Set<Permission>(DEFAULT_ROLE_PERMISSIONS[role]);
  if (role === "college_admin") return granted;
  const roleOverrides = overrides?.[role] ?? {};
  for (const [perm, allow] of Object.entries(roleOverrides)) {
    if (!(perm in PERMISSIONS)) continue;
    if (allow && !NEVER_GRANTABLE[role]?.includes(perm as Permission)) granted.add(perm as Permission);
    if (!allow) granted.delete(perm as Permission);
  }
  return granted;
}

/** Roles whose student visibility is limited (department for HOD, own classes for faculty). */
export type DataScope = { kind: "all" } | { kind: "department"; departmentId: string | null } | { kind: "classes" };

export function scopeForRole(role: Role, departmentId: string | null): DataScope {
  if (role === "hod") return { kind: "department", departmentId };
  if (role === "faculty") return { kind: "classes" };
  return { kind: "all" };
}
