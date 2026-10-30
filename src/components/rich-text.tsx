import type { ReactNode } from "react";

/**
 * Minimal, safe notice formatting (no HTML is ever injected):
 *   **bold**, *italic*, lines starting with "- " become bullets,
 *   lines starting with "1. " become a numbered list, blank lines split paragraphs.
 * Shared by the server-rendered notice pages and the client-side editor preview.
 */
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => /^\s*[-•]\s+/.test(l)))
          return (
            <ul key={i} className="my-2 list-disc space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-•]\s+/, ""))}</li>
              ))}
            </ul>
          );
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l)))
          return (
            <ol key={i} className="my-2 list-decimal space-y-1 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>
              ))}
            </ol>
          );
        return (
          <p key={i} className="my-2 first:mt-0 last:mb-0">
            {lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith("**") ? <strong key={k++}>{t.slice(2, -2)}</strong> : <em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Plain-text preview for cards (formatting markers removed). */
export function plainPreview(text: string, max = 180) {
  const t = text.replace(/\*\*|\*/g, "").replace(/^\s*([-•]|\d+[.)])\s+/gm, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}