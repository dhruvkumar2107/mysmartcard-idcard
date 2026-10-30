"use client";

import { useFormStatus } from "react-dom";
import { useState, type ReactNode } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { buttonBase, buttonStyles, cn } from "./ui";

export function SubmitButton({
  children,
  variant = "primary",
  confirm,
  name,
  value,
  className,
  pendingLabel,
}: {
  children: ReactNode;
  /** Text shown while the form is submitting (e.g. "Uploading…"). */
  pendingLabel?: string;
  variant?: keyof typeof buttonStyles;
  /** Ask for confirmation before submitting (destructive / bulk actions). */
  confirm?: string;
  name?: string;
  value?: string;
  className?: string;
}) {
  const { pending, data } = useFormStatus();
  // With several submit buttons in one form, only the one that was pressed shows progress.
  const mine = pending && (!name || !data || data.get(name) === (value ?? ""));
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className={cn(buttonBase, buttonStyles[variant], className)}
    >
      {mine && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {mine && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn(buttonBase, buttonStyles.secondary)}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {done ? "Copied" : label}
    </button>
  );
}

/** Header checkbox that toggles all row checkboxes sharing `name` within the same form. */
export function SelectAll({ name }: { name: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      className="h-4 w-4 accent-[var(--brand)]"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => (c.checked = e.currentTarget.checked));
      }}
    />
  );
}

/** Sets every attendance radio in the form to a given status. */
export function MarkAll({ status, label }: { status: string; label: string }) {
  return (
    <button
      type="button"
      className={cn(buttonBase, buttonStyles.secondary, "py-1.5 text-xs")}
      onClick={(e) => {
        e.currentTarget.form?.querySelectorAll<HTMLInputElement>(`input[type=radio][value="${status}"]`).forEach((r) => (r.checked = true));
      }}
    >
      {label}
    </button>
  );
}

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={cn(buttonBase, buttonStyles.primary, "no-print")}>
      Print / Save as PDF
    </button>
  );
}
