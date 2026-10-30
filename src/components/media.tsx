"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Expand, Minus, Plus, RotateCcw, X } from "lucide-react";
import { cn } from "./ui";

const btn = "inline-flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50";

/**
 * Zoomable image viewer: buttons, ctrl/⌘ + wheel, double-click/tap to toggle zoom,
 * drag (or scroll) to pan, native pinch-zoom on phones, full-screen and download.
 */
export function ImageViewer({ src, alt, downloadHref, className }: { src: string; alt: string; downloadHref: string; className?: string }) {
  const [zoom, setZoom] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const clamp = (z: number) => Math.min(5, Math.max(1, Math.round(z * 100) / 100));

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clamp(z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const fullscreen = () => {
    const el = box.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (el.requestFullscreen) void el.requestFullscreen();
    else window.open(src, "_blank", "noopener");
  };

  return (
    <div className={cn("overflow-hidden rounded-xl border border-line bg-surface", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-2">
        <button type="button" className={btn} onClick={() => setZoom((z) => clamp(z / 1.25))} disabled={zoom <= 1} aria-label="Zoom out">
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <span className="w-14 text-center text-sm tabular-nums text-muted" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className={btn} onClick={() => setZoom((z) => clamp(z * 1.25))} disabled={zoom >= 5} aria-label="Zoom in">
          <Plus className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" className={btn} onClick={() => setZoom(1)} disabled={zoom === 1} aria-label="Reset zoom">
          <RotateCcw className="h-4 w-4" aria-hidden />
        </button>
        <div className="ml-auto flex gap-2">
          <button type="button" className={btn} onClick={fullscreen} aria-label="View full screen">
            <Expand className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Full screen</span>
          </button>
          <a href={downloadHref} className={cn(btn, "border-transparent bg-brand text-white hover:bg-brand hover:brightness-110")}>
            <Download className="h-4 w-4" aria-hidden /> Download
          </a>
        </div>
      </div>
      <div
        ref={box}
        className={cn("relative max-h-[75vh] overflow-auto bg-surface-2 [touch-action:pan-x_pan-y_pinch-zoom]", zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
        onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
        onPointerDown={(e) => {
          if (zoom === 1 || e.pointerType === "touch") return;
          const el = box.current!;
          drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          box.current!.scrollLeft = d.left - (e.clientX - d.x);
          box.current!.scrollTop = d.top - (e.clientY - d.y);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
      >
        {!loaded && !failed && <div className="skeleton aspect-[4/3] w-full" aria-hidden />}
        {failed && <p className="p-10 text-center text-sm text-muted">The image could not be loaded. Use Download to open the original.</p>}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn("mx-auto block max-w-none select-none", !loaded && "absolute opacity-0")}
          style={{ width: `${zoom * 100}%` }}
        />
      </div>
      <p className="px-3 py-2 text-xs text-muted">Pinch or use the + / − buttons to zoom. Double-click to toggle zoom.</p>
    </div>
  );
}

export type GalleryImage = { id: string; src: string; downloadHref: string; alt: string };

/** Thumbnail grid that opens a full-screen lightbox with zoom, next/prev and download. */
export function Gallery({ images, className }: { images: GalleryImage[]; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : (i + 1) % images.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : (i - 1 + images.length) % images.length));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, images.length, close]);

  if (!images.length) return null;
  const current = open !== null ? images[open] : null;
  return (
    <>
      <ul className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3", className)}>
        {images.map((img, i) => (
          <li key={img.id}>
            <button type="button" onClick={() => setOpen(i)} className="group relative block aspect-[4/3] w-full overflow-hidden rounded-lg border border-line bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label={`Open ${img.alt}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt={img.alt} loading="lazy" className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]" />
            </button>
          </li>
        ))}
      </ul>
      {current && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={current.alt}>
          <div className="mb-3 flex items-center gap-2 text-white">
            <span className="text-sm text-white/70">
              {open! + 1} / {images.length}
            </span>
            <div className="ml-auto flex gap-2">
              <a href={current.downloadHref} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-sm hover:bg-white/25">
                <Download className="h-4 w-4" aria-hidden /> Download
              </a>
              <button type="button" onClick={close} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/15 hover:bg-white/25" aria-label="Close">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>
          <div className="relative min-h-0 flex-1">
            <ImageViewer key={current.id} src={current.src} alt={current.alt} downloadHref={current.downloadHref} className="h-full border-white/10" />
            {images.length > 1 && (
              <>
                <button type="button" onClick={() => setOpen((open! - 1 + images.length) % images.length)} className="absolute left-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80" aria-label="Previous image">
                  <ChevronLeft className="h-6 w-6" aria-hidden />
                </button>
                <button type="button" onClick={() => setOpen((open! + 1) % images.length)} className="absolute right-2 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80" aria-label="Next image">
                  <ChevronRight className="h-6 w-6" aria-hidden />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
const PICKER_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Drag-and-drop image input with instant previews and client-side checks
 * (type, size, count). The server validates everything again.
 */
export function ImageDropInput({ name, multiple = false, required = false, maxFiles = 1, maxBytes = 4 * 1024 * 1024, label = "Drag images here or click to browse" }: { name: string; multiple?: boolean; required?: boolean; maxFiles?: number; maxBytes?: number; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<{ url: string; name: string; size: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const accept = (list: FileList | null) => {
    setError(null);
    const all = Array.from(list ?? []);
    const bad = all.find((f) => !PICKER_TYPES.includes(f.type));
    const big = all.find((f) => f.size > maxBytes);
    const err = bad ? `${bad.name}: use JPG, PNG or WebP.` : big ? `${big.name} is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.` : all.length > maxFiles ? `Choose at most ${maxFiles} image${maxFiles > 1 ? "s" : ""}.` : null;
    if (err) {
      setError(err);
      if (input.current) input.current.value = "";
      setPreviews([]);
      return;
    }
    setPreviews(all.map((f) => ({ url: URL.createObjectURL(f), name: f.name, size: f.size })));
  };

  const total = previews.reduce((s, p) => s + p.size, 0);
  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!input.current) return;
          const dt = new DataTransfer();
          Array.from(e.dataTransfer.files)
            .slice(0, multiple ? maxFiles + 1 : 1)
            .forEach((f) => dt.items.add(f));
          input.current.files = dt.files;
          accept(dt.files);
        }}
        className={cn("flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition", dragging ? "border-brand bg-brand/5" : "border-line hover:border-brand/50 hover:bg-surface-2")}
      >
        <input ref={input} type="file" name={name} multiple={multiple} required={required} accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => accept(e.target.files)} />
        <span className="text-sm font-medium">{label}</span>
        <span className="mt-1 text-xs text-muted">
          JPG, PNG or WebP · up to {Math.round(maxBytes / 1024 / 1024)} MB each{multiple ? ` · max ${maxFiles}` : ""}
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      {previews.length > 0 && (
        <>
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {previews.map((p) => (
              <li key={p.url} className="overflow-hidden rounded-lg border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.name} className="aspect-square w-full object-cover" />
              </li>
            ))}
          </ul>
          <p className={cn("mt-1 text-xs", total > 4.4 * 1024 * 1024 ? "text-danger" : "text-muted")}>
            {previews.length} selected · {(total / 1024 / 1024).toFixed(1)} MB{total > 4.4 * 1024 * 1024 ? " — too large for one upload; add the rest afterwards" : ""}
          </p>
        </>
      )}
    </div>
  );
}
