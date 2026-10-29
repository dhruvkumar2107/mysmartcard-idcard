import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { AdminShell, type NavItem } from "@/components/admin-shell";
import { ROLE_LABELS, type Permission } from "@/lib/permissions";
import { requireTenant } from "@/server/session";
import { logout } from "@/server/actions/auth";

const NAV: (Omit<NavItem, "href"> & { path: string; perm?: Permission; anyOf?: Permission[] })[] = [
  { path: "", label: "Dashboard", icon: "dashboard", group: "Overview", perm: "dashboard.view" },
  { path: "/students", label: "Students", icon: "students", group: "People", perm: "students.view" },
  { path: "/faculty", label: "Faculty", icon: "faculty", group: "People", perm: "faculty.view" },
  { path: "/users", label: "Staff accounts", icon: "users", group: "People", perm: "users.manage" },
  { path: "/academics", label: "Academic structure", icon: "academics", group: "Academics", perm: "academics.manage" },
  { path: "/attendance", label: "Attendance", icon: "attendance", group: "Academics", anyOf: ["attendance.mark", "attendance.view_all"] },
  { path: "/exams", label: "Exams & marks", icon: "exams", group: "Academics", anyOf: ["assessments.manage", "marks.enter", "results.approve", "results.publish"] },
  { path: "/timetable", label: "Timetable", icon: "timetable", group: "Academics", anyOf: ["timetable.manage", "attendance.mark"] },
  { path: "/coursework", label: "Assignments & materials", icon: "coursework", group: "Academics", perm: "coursework.manage" },
  { path: "/notices", label: "Notice board", icon: "notices", group: "Campus", perm: "notices.publish" },
  { path: "/fees", label: "Fees", icon: "fees", group: "Campus", perm: "fees.view" },
  { path: "/library", label: "Library", icon: "library", group: "Campus", perm: "library.manage" },
  { path: "/transport", label: "Transport", icon: "transport", group: "Campus", perm: "transport.manage" },
  { path: "/cards", label: "Digital ID & NFC cards", icon: "cards", group: "Digital ID", perm: "cards.manage" },
  { path: "/portal-designer", label: "Portal designer", icon: "portal", group: "Digital ID", perm: "portal.configure" },
  { path: "/audit", label: "Audit log", icon: "audit", group: "Administration", perm: "audit.view" },
  { path: "/settings", label: "Settings & support", icon: "settings", group: "Administration", perm: "support.grant" },
];

export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requireTenant(slug);
  if (ctx.role === "student") redirect(`/c/${slug}/portal`);
  const base = `/c/${slug}/admin`;
  const nav = NAV.filter((n) => (n.perm ? ctx.perms.has(n.perm) : n.anyOf!.some((p) => ctx.perms.has(p)))).map((n) => ({ label: n.label, icon: n.icon, group: n.group, href: base + n.path }));
  const b = ctx.portalConfig.branding;
  return (
    <div style={{ ["--brand" as string]: b.primaryColor, ["--accent" as string]: b.accentColor }}>
      <AdminShell
        nav={nav}
        college={{ name: ctx.institution.name, shortName: ctx.institution.shortName, logoUrl: b.logoFileId ? `/api/files/${b.logoFileId}` : null }}
        user={{ name: ctx.user.name, role: ctx.viaSupport ? "Platform support (read-only)" : ROLE_LABELS[ctx.role] }}
        searchAction={`${base}/students`}
        canSearch={ctx.perms.has("students.view")}
        banner={
          ctx.viaSupport ? (
            <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">You are viewing this college under a time-limited support grant. All access is read-only and audited.</div>
          ) : ctx.institution.status !== "active" ? (
            <div className="bg-red-100 px-4 py-2 text-center text-sm text-red-900">This workspace is suspended.</div>
          ) : null
        }
        signOut={
          <form action={logout}>
            <button className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        }
      >
        {children}
      </AdminShell>
    </div>
  );
}
