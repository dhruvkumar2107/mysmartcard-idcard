"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Bold, GraduationCap, ImagePlus, Italic, List, ListOrdered, Loader2, Trash2, Upload, Users } from "lucide-react";
import { RichText, plainPreview } from "./rich-text";
import { buttonBase, buttonStyles, cn } from "./ui";

type Opt = { value: string; label: string };
export type NoticeEditorInitial = {
  id?: string;
  title: string;
  body: string;
  category: string;
  audienceType: "students" | "teachers";
  scope: "all" | "targeted";
  departmentIds: string[];
  programmeIds: string[];
  semesters: number[];
  sectionIds: string[];
  publishAt: string;
  expiresAt: string;
  pinned: boolean;
  notifyEmail: boolean;
  imageUrl: string | null;
  imagePosition: "top" | "center" | "bottom";
  status: string;
};

const control = "block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
const MAX_IMAGE = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function NoticeEditor({
  action,
  slug,
  back,
  initial,
  categories,
  departments,
  programmes,
  sections,
  hod,
  emailConfigured,
}: {
  action: (fd: FormData) => Promise<void>;
  slug: string;
  back: string;
  initial: NoticeEditorInitial;
  categories: Opt[];
  departments: Opt[];
  programmes: Opt[];
  sections: Opt[];
  hod: boolean;
  emailConfigured: boolean;
}) {
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [category, setCategory] = useState(initial.category);
  const [audienceType, setAudienceType] = useState(initial.audienceType);
  const [scope, setScope] = useState(hod ? "targeted" : initial.scope);
  const [image, setImage] = useState<string | null>(initial.imageUrl);
  const [imageName, setImageName] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [position, setPosition] = useState(initial.imagePosition);
  const [publishAt, setPublishAt] = useState(initial.publishAt);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const objectUrl = useRef<string | null>(null);
  const editing = !!initial.id;

  useEffect(() => () => void (objectUrl.current && URL.revokeObjectURL(objectUrl.current)), []);

  const acceptFile = (f: File | undefined | null) => {
    setError(null);
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) return setError("Use a JPG, PNG or WebP image.");
    if (f.size > MAX_IMAGE) return setError("The image must be 4 MB or smaller.");
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(f);
    setImage(objectUrl.current);
    setImageName(f.name);
    setRemoveImage(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (!f || !fileInput.current) return;
    const dt = new DataTransfer();
    dt.items.add(f);
    fileInput.current.files = dt.files;
    acceptFile(f);
  };

  const clearImage = () => {
    if (fileInput.current) fileInput.current.value = "";
    setImage(null);
    setImageName(null);
    setRemoveImage(editing && !!initial.imageUrl);
  };

  const wrap = (before: string, after = before) => {
    const el = bodyRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = body.slice(a, b) || "text";
    const next = body.slice(0, a) + before + sel + after + body.slice(b);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + before.length, a + before.length + sel.length);
    });
  };
  const prefixLines = (numbered: boolean) => {
    const el = bodyRef.current;
    if (!el) return;
    const a = body.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const b = el.selectionEnd;
    const lines = (body.slice(a, b) || "Item").split("\n").map((l, i) => `${numbered ? `${i + 1}.` : "-"} ${l.replace(/^\s*([-•]|\d+[.)])\s+/, "")}`);
    setBody(body.slice(0, a) + lines.join("\n") + body.slice(b));
    requestAnimationFrame(() => el.focus());
  };

  const validate = (e: React.FormEvent<HTMLFormElement>) => {
    if (title.trim().length < 3) {
      e.preventDefault();
      setError("Give the notice a title of at least 3 characters.");
      return;
    }
    if (!body.trim()) {
      e.preventDefault();
      setError("Write the notice text.");
      return;
    }
    const fd = new FormData(e.currentTarget);
    if (fd.get("scope") === "targeted" && !hod && !["departmentIds", "programmeIds", "semesters", "sectionIds"].some((k) => fd.getAll(k).length)) {
      e.preventDefault();
      setError("Choose at least one audience filter, or send to everyone.");
    }
  };

  const previewDate = publishAt ? new Date(publishAt) : new Date();
  const audienceLabel = audienceType === "teachers" ? "Teachers" : "Students";

  return (
    <form action={action} onSubmit={validate} encType="multipart/form-data" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
      <input type="hidden" name="_slug" value={slug} />
      <input type="hidden" name="_back" value={back} />
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="audienceType" value={audienceType} />
      <input type="hidden" name="imagePosition" value={position} />
      {removeImage && <input type="hidden" name="removeImage" value="true" />}

      <div className="space-y-5">
        <Section title="Audience">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Notice board">
            <AudienceButton on={audienceType === "students"} onClick={() => setAudienceType("students")} icon={<GraduationCap className="h-5 w-5" aria-hidden />} title="Student notice" sub="Shown only to students" />
            <AudienceButton on={audienceType === "teachers"} onClick={() => setAudienceType("teachers")} icon={<Users className="h-5 w-5" aria-hidden />} title="Teacher notice" sub="Shown only to faculty" />
          </div>
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            {!hod && (
              <label className="inline-flex items-center gap-2">
                <input type="radio" name="scope" value="all" checked={scope === "all"} onChange={() => setScope("all")} className="accent-[var(--brand)]" /> All {audienceLabel.toLowerCase()}
              </label>
            )}
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="scope" value="targeted" checked={scope === "targeted"} onChange={() => setScope("targeted")} className="accent-[var(--brand)]" /> {hod ? "My department" : "Specific groups"}
            </label>
          </div>
          {scope === "targeted" && !hod && (
            <div className="mt-4 space-y-4">
              <ChipGroup name="departmentIds" label="Departments" options={departments} initial={initial.departmentIds} />
              {audienceType === "students" && (
                <>
                  <ChipGroup name="programmeIds" label="Programmes" options={programmes} initial={initial.programmeIds} />
                  <ChipGroup name="semesters" label="Semesters" options={Array.from({ length: 8 }, (_, i) => ({ value: String(i + 1), label: `Sem ${i + 1}` }))} initial={initial.semesters.map(String)} />
                  <ChipGroup name="sectionIds" label="Sections" options={sections} initial={initial.sectionIds} />
                  <p className="text-xs text-muted">Filters combine: e.g. a department + semester 3 reaches only semester-3 students of that department.</p>
                </>
              )}
            </div>
          )}
        </Section>

        <Section title="Content">
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Title</span>
            <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required className={control} placeholder="e.g. Mid-semester examination schedule" />
          </label>
          <div className="mt-4">
            <span className="mb-1 block text-sm font-medium" id="body-label">
              Notice text
            </span>
            <div className="flex gap-1 rounded-t-lg border border-b-0 border-line bg-surface-2 p-1" role="toolbar" aria-label="Formatting">
              <ToolButton label="Bold" onClick={() => wrap("**")}>
                <Bold className="h-4 w-4" />
              </ToolButton>
              <ToolButton label="Italic" onClick={() => wrap("*")}>
                <Italic className="h-4 w-4" />
              </ToolButton>
              <ToolButton label="Bulleted list" onClick={() => prefixLines(false)}>
                <List className="h-4 w-4" />
              </ToolButton>
              <ToolButton label="Numbered list" onClick={() => prefixLines(true)}>
                <ListOrdered className="h-4 w-4" />
              </ToolButton>
            </div>
            <textarea ref={bodyRef} name="body" value={body} onChange={(e) => setBody(e.target.value)} rows={9} required maxLength={10000} aria-labelledby="body-label" className={cn(control, "rounded-t-none")} placeholder="Write the full notice. Leave a blank line between paragraphs." />
            <p className="mt-1 text-xs text-muted">**bold**, *italic*, lines starting with “- ” become bullets.</p>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Category</span>
              <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} className={control}>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Attachment (optional)</span>
              <input type="file" name="attachment" accept=".pdf,.jpg,.jpeg,.png,.docx,.pptx" className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-sm" />
            </label>
          </div>
        </Section>

        <Section title="Image">
          <input ref={fileInput} type="file" name="image" accept="image/jpeg,image/png,image/webp" className="sr-only" id="notice-image" onChange={(e) => acceptFile(e.target.files?.[0])} />
          {image ? (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="Selected notice image" className="aspect-[16/9] w-full object-cover" style={{ objectPosition: position }} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted">Focus:</span>
                {(["top", "center", "bottom"] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setPosition(p)} aria-pressed={position === p} className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium capitalize", position === p ? "border-brand bg-brand/10 text-brand" : "border-line hover:bg-surface-2")}>
                    {p}
                  </button>
                ))}
                <span className="flex-1" />
                <label htmlFor="notice-image" className={cn(buttonBase, buttonStyles.secondary, "cursor-pointer py-1.5 text-xs")}>
                  <ImagePlus className="h-4 w-4" aria-hidden /> Replace
                </label>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Remove this image from the notice?")) clearImage();
                  }}
                  className={cn(buttonBase, buttonStyles.ghost, "py-1.5 text-xs text-danger")}
                >
                  <Trash2 className="h-4 w-4" aria-hidden /> Remove
                </button>
              </div>
              {imageName && <p className="text-xs text-muted">{imageName} will be uploaded when you save.</p>}
            </div>
          ) : (
            <label
              htmlFor="notice-image"
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition", dragging ? "border-brand bg-brand/5" : "border-line hover:border-brand/50 hover:bg-surface-2")}
            >
              <Upload className="mb-2 h-6 w-6 text-muted" aria-hidden />
              <span className="text-sm font-medium">Drag an image here or click to browse</span>
              <span className="mt-1 text-xs text-muted">JPG, PNG or WebP · up to 4 MB</span>
            </label>
          )}
        </Section>

        <Section title="Schedule & options">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Publication date</span>
              <input type="datetime-local" name="publishAt" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} className={control} />
              <span className="mt-1 block text-xs text-muted">Blank = immediately when published.</span>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Expiry date (optional)</span>
              <input type="datetime-local" name="expiresAt" defaultValue={initial.expiresAt} className={control} />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" name="pinned" defaultChecked={initial.pinned} className="h-4 w-4 accent-[var(--brand)]" /> Pin to top
            </label>
            {audienceType === "students" && (
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" name="notifyEmail" defaultChecked={initial.notifyEmail} className="h-4 w-4 accent-[var(--brand)]" /> Also email students{!emailConfigured && " (email not configured — logged only)"}
              </label>
            )}
            {editing && initial.status === "published" && (
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" name="majorUpdate" className="h-4 w-4 accent-[var(--brand)]" /> Major update — notify readers again
              </label>
            )}
          </div>
        </Section>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {error}
          </p>
        )}
        <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap justify-end gap-2 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          <a href={back} className={cn(buttonBase, buttonStyles.ghost)}>
            Cancel
          </a>
          <Submit intent="draft" variant="secondary">
            Save draft
          </Submit>
          <Submit intent="publish">{editing && initial.status === "published" ? "Update notice" : "Publish"}</Submit>
        </div>
      </div>

      <aside className="lg:sticky lg:top-20 lg:self-start" aria-label="Live preview">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold">Live preview</span>
          <span className="text-xs text-muted">As {audienceLabel.toLowerCase()} see it</span>
        </div>
        <article className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          {image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="aspect-[16/9] w-full object-cover" style={{ objectPosition: position }} />
          )}
          <div className="p-4">
            <div className="mb-2 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[11px] font-semibold text-white">New</span>
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium capitalize text-sky-700 ring-1 ring-inset ring-sky-600/20">{category}</span>
            </div>
            <h3 className="font-semibold leading-snug">{title || "Notice title"}</h3>
            <p className="mt-1.5 line-clamp-3 text-sm text-muted">{plainPreview(body) || "The first lines of your notice appear here."}</p>
            <p className="mt-3 text-xs text-muted">{previewDate.toLocaleDateString("en-IN", { dateStyle: "medium" })}</p>
          </div>
        </article>
        <details className="mt-4 rounded-xl border border-line bg-surface p-4" open>
          <summary className="cursor-pointer text-sm font-medium">Full notice</summary>
          <RichText text={body || "…"} className="mt-3 text-sm leading-relaxed" />
        </details>
      </aside>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="mb-4 text-[15px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function AudienceButton({ on, onClick, icon, title, sub }: { on: boolean; onClick: () => void; icon: ReactNode; title: string; sub: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} className={cn("flex items-center gap-3 rounded-xl border p-3 text-left transition", on ? "border-brand bg-brand/5 ring-1 ring-brand" : "border-line hover:bg-surface-2")}>
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", on ? "bg-brand text-white" : "bg-surface-2 text-muted")}>{icon}</span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{sub}</span>
      </span>
    </button>
  );
}

function ChipGroup({ name, label, options, initial }: { name: string; label: string; options: Opt[]; initial: string[] }) {
  if (!options.length) return null;
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label key={o.value} className="cursor-pointer">
            <input type="checkbox" name={name} value={o.value} defaultChecked={initial.includes(o.value)} className="peer sr-only" />
            <span className="inline-block rounded-full border border-line px-3 py-1 text-xs font-medium transition peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent hover:bg-surface-2 peer-checked:hover:bg-brand">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface hover:text-ink">
      {children}
    </button>
  );
}

function Submit({ intent, variant = "primary", children }: { intent: string; variant?: keyof typeof buttonStyles; children: ReactNode }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button type="submit" name="intent" value={intent} disabled={pending} className={cn(buttonBase, buttonStyles[variant])}>
      {mine && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}