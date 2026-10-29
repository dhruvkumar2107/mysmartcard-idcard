import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand";
import { requireSuperAdmin } from "@/server/session";
import { logout } from "@/server/actions/auth";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const user = await requireSuperAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <Link href="/platform">
            <BrandMark />
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/platform" className="text-muted hover:text-ink">
              Colleges
            </Link>
            <Link href="/platform/audit" className="text-muted hover:text-ink">
              Audit
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{user.name} · Platform super admin</span>
            <form action={logout}>
              <button className="text-muted hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
