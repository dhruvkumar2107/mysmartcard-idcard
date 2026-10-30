"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Megaphone, X } from "lucide-react";
import { cn } from "./ui";

type Item = { id: string; title: string; category: string; publishAt: string | null; unread: boolean; hasImage: boolean };
type Summary = { unread: number; items: Item[] };

const READ_EVENT = "msc:notice-read";
const POLL_MS = 30_000;

/**
 * In-app notification bell. Polls the server (and refreshes on focus / after a notice
 * is read), shows the unread count, a dropdown of recent notices and a toast when a new
 * notice arrives while the page is open. This is not a device push notification.
 */
export function NotificationBell({ slug, noticeHref, tone = "light" }: { slug: string; noticeHref: string; tone?: "light" | "dark" }) {
  const [data, setData] = useState<Summary | null>(null);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Item | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/c/${encodeURIComponent(slug)}/notifications`, { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as Summary;
      // Toast only for notices that appeared since the previous poll (never on first load).
      if (seen.current) {
        const fresh = next.items.find((i) => i.unread && !seen.current!.has(i.id));
        if (fresh) setToast(fresh);
      }
      seen.current = new Set(next.items.map((i) => i.id));
      setData(next);
    } catch {
      // Offline or transient error: keep the last known state.
    }
  }, [slug]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener(READ_EVENT, onFocus);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(READ_EVENT, onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = data?.unread ?? 0;
  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications: ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className={cn("relative grid h-10 w-10 place-items-center rounded-lg transition", tone === "light" ? "text-white hover:bg-white/15" : "text-muted hover:bg-surface-2 hover:text-ink")}
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unread > 0 && <span className="absolute right-1 top-1 grid min-w-[18px] place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-[18px] text-white ring-2 ring-white/80">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            <span className="text-xs text-muted">{unread ? `${unread} unread` : "All caught up"}</span>
          </div>
          {!data ? (
            <div className="space-y-2 p-4" aria-hidden>
              <div className="skeleton h-4 w-3/4 rounded" />
              <div className="skeleton h-4 w-1/2 rounded" />
            </div>
          ) : data.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">No notices yet.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {data.items.map((n) => (
                <li key={n.id}>
                  <Link href={`${noticeHref}/${n.id}`} onClick={() => setOpen(false)} className={cn("flex gap-3 px-4 py-3 text-sm hover:bg-surface-2", n.unread && "bg-brand/5")}>
                    <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.unread ? "bg-brand" : "bg-transparent")} aria-hidden />
                    <span className="min-w-0">
                      <span className={cn("block truncate", n.unread ? "font-semibold" : "text-ink/80")}>{n.title}</span>
                      <span className="text-xs capitalize text-muted">
                        {n.category} · {n.publishAt ? new Date(n.publishAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : ""}
                        {n.unread && <span className="sr-only"> (unread)</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href={noticeHref} onClick={() => setOpen(false)} className="block border-t border-line px-4 py-2.5 text-center text-sm font-medium text-brand hover:bg-surface-2">
            Open notice board
          </Link>
        </div>
      )}
      {toast && (
        <div role="status" className="fade-in fixed bottom-24 left-1/2 z-50 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-3 rounded-xl border border-line bg-surface p-4 text-ink shadow-2xl md:bottom-6 md:left-auto md:right-6 md:translate-x-0">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand">
            <Megaphone className="h-5 w-5" aria-hidden />
          </span>
          <Link href={`${noticeHref}/${toast.id}`} onClick={() => setToast(null)} className="min-w-0 flex-1">
            <span className="block text-xs font-medium uppercase tracking-wide text-muted">New notice</span>
            <span className="block truncate text-sm font-semibold">{toast.title}</span>
          </Link>
          <button type="button" onClick={() => setToast(null)} className="text-muted hover:text-ink" aria-label="Dismiss">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

/** Marks one notice as read when its detail view is opened, then refreshes the bell. */
export function MarkNoticeRead({ slug, id, unread }: { slug: string; id: string; unread: boolean }) {
  useEffect(() => {
    if (!unread) return;
    void fetch(`/api/c/${encodeURIComponent(slug)}/notices/${id}/read`, { method: "POST" }).then((r) => r.ok && window.dispatchEvent(new Event(READ_EVENT)));
  }, [slug, id, unread]);
  return null;
}