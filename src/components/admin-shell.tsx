"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  BookOpen,
  Bus,
  CalendarClock,
  ChevronsLeft,
  ClipboardCheck,
  CreditCard,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Library,
  Megaphone,
  Menu,
  Palette,
  ScrollText,
  Search,
  Settings,
  Users,
  UserCog,
  Wallet,
  Network,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "./ui";

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  students: GraduationCap,
  faculty: Users,
  academics: Network,
  attendance: ClipboardCheck,
  exams: FileText,
  timetable: CalendarClock,
  notices: Megaphone,
  coursework: BookOpen,
  fees: Wallet,
  library: Library,
  transport: Bus,
  cards: CreditCard,
  portal: Palette,
  users: UserCog,
  audit: ScrollText,
  settings: Settings,
};

/** Sidebar collapsed preference, persisted per browser. Storage failures (private mode) fall back to expanded. */
const sidebarStore = (() => {
  const listeners = new Set<() => void>();
  return {
    get: () => {
      try {
        return localStorage.getItem("msc_sidebar") === "1";
      } catch {
        return false;
      }
    },
    set: (v: boolean) => {
      try {
        localStorage.setItem("msc_sidebar", v ? "1" : "0");
      } catch {}
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
})();

export type NavItem = { href: string; label: string; icon: string; group: string };

export function AdminShell({
  nav,
  college,
  user,
  searchAction,
  canSearch,
  banner,
  children,
  signOut,
}: {
  nav: NavItem[];
  college: { name: string; shortName: string; logoUrl: string | null };
  user: { name: string; role: string };
  searchAction: string;
  canSearch: boolean;
  banner?: ReactNode;
  children: ReactNode;
  signOut: ReactNode;
}) {
  const pathname = usePathname();
  const collapsed = useSyncExternalStore(sidebarStore.subscribe, sidebarStore.get, () => false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = () => sidebarStore.set(!collapsed);

  const groups = [...new Set(nav.map((n) => n.group))];
  const isActive = (href: string) => (href.endsWith("/admin") ? pathname === href : pathname.startsWith(href));

  const sidebar = (mobile: boolean) => (
    <div className="flex h-full flex-col">
      <div className={cn("flex h-16 items-center gap-2 border-b border-white/10 px-4", collapsed && !mobile && "justify-center px-2")}>
        {college.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={college.logoUrl} alt="" className="h-8 w-8 rounded-md bg-white object-contain p-0.5" />
        ) : (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/15 text-xs font-bold">{college.shortName.slice(0, 3)}</span>
        )}
        {(!collapsed || mobile) && <span className="truncate text-sm font-semibold">{college.name}</span>}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Admin">
        {groups.map((g) => (
          <div key={g} className="mb-3">
            {(!collapsed || mobile) && <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/50">{g}</div>}
            {nav
              .filter((n) => n.group === g)
              .map((n) => {
                const Icon = ICONS[n.icon] ?? LayoutDashboard;
                const active = isActive(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    title={collapsed && !mobile ? n.label : undefined}
                    onClick={() => mobile && setMobileOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn("flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-white/80 transition hover:bg-white/10 hover:text-white", active && "bg-white/15 text-white", collapsed && !mobile && "justify-center")}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {(!collapsed || mobile) && <span className="truncate">{n.label}</span>}
                  </Link>
                );
              })}
          </div>
        ))}
      </nav>
      {!mobile && (
        <button onClick={toggle} className="flex items-center gap-2 border-t border-white/10 px-4 py-3 text-xs text-white/60 hover:text-white" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <ChevronsLeft className={cn("h-4 w-4 transition", collapsed && "rotate-180")} aria-hidden />
          {!collapsed && "Collapse"}
        </button>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen">
      <aside className={cn("no-print sticky top-0 hidden h-screen shrink-0 bg-[color-mix(in_srgb,var(--brand)_92%,black)] text-white transition-[width] lg:block", collapsed ? "w-[68px]" : "w-64")}>{sidebar(false)}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-[color-mix(in_srgb,var(--brand)_92%,black)] text-white">
            <button className="absolute right-3 top-4 text-white/70" onClick={() => setMobileOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            {sidebar(true)}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          {canSearch && (
            <form action={searchAction} className="relative max-w-md flex-1" role="search">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input name="q" placeholder="Search students by name, enrollment no. or email" aria-label="Search students" className="w-full rounded-lg border border-line bg-surface-2 py-2 pl-9 pr-3 text-sm focus:border-accent focus:bg-surface focus:outline-none" />
            </form>
          )}
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium leading-tight">{user.name}</div>
              <div className="text-xs text-muted">{user.role}</div>
            </div>
            {signOut}
          </div>
        </header>
        {banner}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
