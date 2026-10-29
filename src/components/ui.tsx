import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Inbox } from "lucide-react";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- Layout

export function PageHeader({ title, description, actions, back }: { title: string; description?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-sm text-muted hover:text-ink">
            ← {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, description, actions, children, className, padded = true }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={padded ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default", href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "default" | "ok" | "warn" | "danger"; href?: string }) {
  const body = (
    <div className={cn("rounded-xl border border-line bg-surface p-4 transition", href && "hover:border-brand/40 hover:shadow-sm")}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "danger" && "text-danger")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <Inbox className="mb-2 h-6 w-6 text-muted" aria-hidden />
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Flash({ searchParams }: { searchParams: { flash?: string; kind?: string } }) {
  if (!searchParams.flash) return null;
  const ok = searchParams.kind !== "err";
  return (
    <div role={ok ? "status" : "alert"} className={cn("fade-in mb-5 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm", ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900")}>
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <span className="whitespace-pre-line">{searchParams.flash}</span>
    </div>
  );
}

export function Alert({ tone = "info", children }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode }) {
  const styles = { info: "border-sky-200 bg-sky-50 text-sky-900", warn: "border-amber-200 bg-amber-50 text-amber-900", danger: "border-red-200 bg-red-50 text-red-900", ok: "border-emerald-200 bg-emerald-50 text-emerald-900" };
  return <div className={cn("rounded-lg border px-4 py-3 text-sm", styles[tone])}>{children}</div>;
}

// ---------------------------------------------------------------- Badges

const BADGE_TONES: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  gray: "bg-slate-50 text-slate-600 ring-slate-500/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
};

export function Badge({ tone = "gray", children }: { tone?: keyof typeof BADGE_TONES; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", BADGE_TONES[tone])}>{children}</span>;
}

const STATUS_TONE: Record<string, keyof typeof BADGE_TONES> = {
  active: "green",
  published: "green",
  paid: "green",
  approved: "blue",
  submitted: "amber",
  pending: "amber",
  partial: "amber",
  due: "blue",
  draft: "gray",
  inactive: "gray",
  unassigned: "gray",
  graduated: "violet",
  suspended: "red",
  archived: "gray",
  overdue: "red",
  lost: "red",
  damaged: "red",
  revoked: "red",
  rejected: "red",
  disabled: "red",
  present: "green",
  absent: "red",
  late: "amber",
  excused: "blue",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "gray"}>{status.replace(/_/g, " ")}</Badge>;
}

// ---------------------------------------------------------------- Forms

const control = "block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-surface-2";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cn(control, props.className)} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea rows={4} {...props} className={cn(control, props.className)} />;
}

export function Select({ options, placeholder, ...props }: ComponentProps<"select"> & { options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select {...props} className={cn(control, "pr-8", props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({ label, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="checkbox" {...props} className="h-4 w-4 rounded border-line text-brand accent-[var(--brand)]" />
      {label}
    </label>
  );
}

/** Hidden fields that every tenant server action needs. */
export function TenantFields({ slug, back }: { slug: string; back: string }) {
  return (
    <>
      <input type="hidden" name="_slug" value={slug} />
      <input type="hidden" name="_back" value={back} />
    </>
  );
}

export const buttonStyles = {
  primary: "bg-brand text-white hover:brightness-110 shadow-sm",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
  danger: "bg-danger text-white hover:brightness-110",
  ghost: "text-ink hover:bg-surface-2",
};
export const buttonBase = "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-60 disabled:cursor-not-allowed";

export function LinkButton({ href, variant = "secondary", children, className, ...rest }: { href: string; variant?: keyof typeof buttonStyles; children: ReactNode; className?: string } & Omit<ComponentProps<typeof Link>, "href">) {
  return (
    <Link href={href} className={cn(buttonBase, buttonStyles[variant], className)} {...rest}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- Tables

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("border-b border-line bg-surface-2/60 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted", className)}>{children}</th>;
}
export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-line px-4 py-3 align-middle", className)}>
      {children}
    </td>
  );
}

export function Pagination({ page, pages, total, makeHref }: { page: number; pages: number; total: number; makeHref: (p: number) => string }) {
  if (pages <= 1) return <p className="px-4 py-3 text-xs text-muted">{total} record(s)</p>;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between px-4 py-3 text-sm">
      <span className="text-muted">
        Page {page} of {pages} · {total} records
      </span>
      <div className="flex gap-2">
        {page > 1 && <LinkButton href={makeHref(page - 1)}>Previous</LinkButton>}
        {page < pages && <LinkButton href={makeHref(page + 1)}>Next</LinkButton>}
      </div>
    </nav>
  );
}

export function Tabs({ tabs, active, makeHref }: { tabs: { key: string; label: string }[]; active: string; makeHref: (k: string) => string }) {
  return (
    <nav className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line" aria-label="Sections">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={makeHref(t.key)}
          aria-current={t.key === active ? "page" : undefined}
          className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", t.key === active ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink")}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function Meter({ value, threshold }: { value: number | null; threshold?: number }) {
  const v = value ?? 0;
  const tone = threshold !== undefined && value !== null && v < threshold ? "bg-danger" : "bg-ok";
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, v)}%` }} />
      {threshold !== undefined && <div className="absolute top-0 h-full w-0.5 bg-ink/40" style={{ left: `${threshold}%` }} aria-hidden />}
    </div>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{k}</dt>
          <dd className="mt-0.5 text-sm">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
