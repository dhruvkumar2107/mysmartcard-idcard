/** Shared prop shapes for App Router pages (params and searchParams are Promises in Next 15+). */
export type SP = Record<string, string | string[] | undefined>;
export type Props<P extends Record<string, string | string[] | undefined> = Record<string, string>> = { params: Promise<P>; searchParams: Promise<SP> };
export type SlugProps<P extends Record<string, string | string[] | undefined> = Record<string, never>> = Props<{ slug: string } & P>;

export function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function flashOf(sp: SP) {
  return { flash: one(sp.flash), kind: one(sp.kind) };
}

export function qs(base: string, params: Record<string, string | number | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}
