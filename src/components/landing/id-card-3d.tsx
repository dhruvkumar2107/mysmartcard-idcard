"use client";

import { useRef, useState } from "react";
import { Nfc, ShieldCheck } from "lucide-react";

/**
 * Interactive sample ID card for the landing page: floats, tilts toward the
 * pointer with a moving light sheen, and flips on click/tap. Pure CSS 3D.
 */
export function IdCard3D() {
  const tilt = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);

  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "mouse" || !tilt.current) return;
    const r = tilt.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const s = tilt.current.style;
    s.setProperty("--rx", `${(0.5 - y) * 22}deg`);
    s.setProperty("--ry", `${(x - 0.5) * 28}deg`);
    s.setProperty("--mx", `${x * 100}%`);
    s.setProperty("--my", `${y * 100}%`);
  }
  function leave() {
    const s = tilt.current?.style;
    if (!s) return;
    s.setProperty("--rx", "0deg");
    s.setProperty("--ry", "0deg");
    s.setProperty("--mx", "30%");
    s.setProperty("--my", "20%");
  }

  return (
    <div className="relative grid place-items-center [perspective:1400px]">
      {/* NFC field radiating from behind the card */}
      <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
        {[0, 0.8, 1.6].map((d) => (
          <span key={d} className="nfc-ripple absolute h-56 w-56 rounded-full border border-sky-300/40" style={{ animationDelay: `${d}s` }} />
        ))}
      </div>
      <div className="card-float">
        <div
          ref={tilt}
          onPointerMove={move}
          onPointerLeave={leave}
          className="transition-transform duration-200 ease-out [transform-style:preserve-3d]"
          style={{ transform: "rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg))" }}
        >
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            aria-pressed={flipped}
            aria-label={flipped ? "Show the front of the sample ID card" : "Flip the sample ID card"}
            className="@container relative block aspect-[1.586] w-[min(86vw,420px)] cursor-pointer rounded-[6cqw] text-left transition-transform duration-700 [transform-style:preserve-3d] [transition-timing-function:cubic-bezier(.2,.8,.2,1)]"
            style={{ transform: flipped ? "rotateY(180deg)" : "none" }}
          >
            <Front />
            <Back />
          </button>
        </div>
      </div>
      <p className="mt-8 text-xs text-slate-400">
        <span className="[@media(hover:hover)]:hidden">Tap the card to flip it</span>
        <span className="hidden [@media(hover:hover)]:inline">Move your cursor over the card · click to flip</span>
      </p>
    </div>
  );
}

const face = "absolute inset-0 overflow-hidden rounded-[5.5cqw] backface-hidden shadow-[0_30px_80px_-20px_rgba(14,165,233,.45),0_0_0_1px_rgba(255,255,255,.12)_inset]";

function Sheen() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 mix-blend-overlay"
      style={{ background: "radial-gradient(circle at var(--mx, 30%) var(--my, 20%), rgba(255,255,255,.55), transparent 45%)" }}
    />
  );
}

function Front() {
  return (
    <div className={`${face} bg-[linear-gradient(135deg,#1e3a8a_0%,#312e81_45%,#0f172a_100%)] text-white`}>
      <div aria-hidden className="absolute -right-[20cqw] -top-[30cqw] h-[70cqw] w-[70cqw] rounded-full bg-sky-400/25 blur-2xl" />
      <div aria-hidden className="absolute -bottom-[30cqw] -left-[15cqw] h-[60cqw] w-[60cqw] rounded-full bg-fuchsia-500/20 blur-2xl" />
      <div className="relative flex h-full flex-col p-[5.5cqw]">
        <div className="flex items-start justify-between gap-[3cqw]">
          <div className="flex items-center gap-[2.5cqw]">
            <span className="grid h-[9cqw] w-[9cqw] place-items-center rounded-[2.5cqw] bg-white/15 text-[3.4cqw] font-bold ring-1 ring-white/25">NIT</span>
            <div className="leading-tight">
              <div className="text-[3.6cqw] font-semibold">Northbridge Institute of Technology</div>
              <div className="text-[2.4cqw] uppercase tracking-[0.18em] text-sky-200/80">Student identity card</div>
            </div>
          </div>
          <Nfc className="h-[6.5cqw] w-[6.5cqw] shrink-0 text-sky-200" aria-hidden />
        </div>

        <div className="mt-[4.5cqw] flex gap-[4cqw]">
          <div className="relative grid h-[25cqw] w-[20cqw] shrink-0 place-items-center overflow-hidden rounded-[2.5cqw] bg-[linear-gradient(160deg,#38bdf8,#6366f1)] text-[7cqw] font-semibold ring-2 ring-white/30">
            AS
            <span className="holo absolute inset-x-0 bottom-0 h-[2cqw] opacity-80" />
          </div>
          <div className="min-w-0 space-y-[1.2cqw]">
            <div className="text-[5.4cqw] font-semibold leading-none">Aarav Sharma</div>
            <div className="font-mono text-[3.2cqw] text-sky-100/90">NIT/CSE/2024/017</div>
            <div className="text-[3cqw] text-slate-300">B.Tech Computer Science</div>
            <div className="flex flex-wrap gap-[1.5cqw] pt-[0.5cqw] text-[2.5cqw] font-medium">
              <span className="rounded-full bg-emerald-400/20 px-[2cqw] py-[0.4cqw] text-emerald-200 ring-1 ring-emerald-300/30">Active</span>
              <span className="rounded-full bg-white/10 px-[2cqw] py-[0.4cqw] ring-1 ring-white/20">Sem 3</span>
              <span className="rounded-full bg-rose-400/20 px-[2cqw] py-[0.4cqw] text-rose-200 ring-1 ring-rose-300/30">B+</span>
            </div>
          </div>
        </div>

        <div className="mt-auto flex items-end justify-between">
          <div className="h-[8cqw] w-[11cqw] rounded-[1.5cqw] bg-[linear-gradient(135deg,#fde68a,#d97706)] p-[1cqw] shadow-inner">
            <div className="grid h-full grid-cols-3 gap-[0.6cqw] opacity-50">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className="rounded-[0.5cqw] border border-amber-900/50" />
              ))}
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center justify-end gap-[1cqw] text-[2.6cqw] text-emerald-200">
              <ShieldCheck className="h-[3cqw] w-[3cqw]" aria-hidden /> Verified by tap
            </div>
            <div className="text-[2.4cqw] text-slate-400">Valid till Jun 2028</div>
          </div>
        </div>
      </div>
      <Sheen />
    </div>
  );
}

/** Decorative QR-style pattern, deterministic so server and client agree. */
const QR = Array.from({ length: 121 }, (_, i) => ((i * 7919) % 13) % 3 !== 0);

function Back() {
  return (
    <div className={`${face} bg-[linear-gradient(135deg,#0f172a,#1e293b)] text-white`} style={{ transform: "rotateY(180deg)" }}>
      <div className="mt-[7cqw] h-[11cqw] bg-black/70" />
      <div className="flex items-center gap-[5cqw] p-[5.5cqw]">
        <div className="grid h-[24cqw] w-[24cqw] shrink-0 grid-cols-11 gap-[0.3cqw] rounded-[2cqw] bg-white p-[1.6cqw]">
          {QR.map((on, i) => (
            <span key={i} className={on ? "bg-slate-900" : ""} />
          ))}
        </div>
        <div className="min-w-0 space-y-[1.5cqw]">
          <div className="flex items-center gap-[1.5cqw] text-[3.8cqw] font-semibold">
            <Nfc className="h-[4.5cqw] w-[4.5cqw] text-sky-300" aria-hidden /> Tap to open portal
          </div>
          <p className="text-[2.7cqw] leading-snug text-slate-300">Hold this card near any NFC phone, or scan the code, to open the student&apos;s verified campus profile.</p>
          <p className="text-[2.4cqw] text-slate-500">If found, please return to the college office.</p>
        </div>
      </div>
      <div className="holo absolute inset-x-0 bottom-0 h-[1.6cqw] opacity-70" />
      <Sheen />
    </div>
  );
}
