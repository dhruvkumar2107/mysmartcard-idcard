import { titleCase } from "@/lib/format";
import type { TenantContext } from "@/server/context";
import { listStructure, sectionLabel } from "@/server/services/academics";
import { NOTICE_CATEGORIES } from "@/server/services/notices";

/** Option lists for the notice editor, scoped to the caller's college. */
export async function editorOptions(ctx: TenantContext) {
  const s = await listStructure(ctx);
  return {
    categories: NOTICE_CATEGORIES.map((c) => ({ value: c, label: titleCase(c) })),
    departments: s.departments.map((d) => ({ value: d.id, label: d.code })),
    programmes: s.programmes.map((p) => ({ value: p.id, label: p.code })),
    sections: s.sections.map((x) => ({ value: x.section.id, label: sectionLabel(x) })),
    hod: ctx.scope.kind === "department",
    emailConfigured: !!process.env.EMAIL_PROVIDER,
  };
}

/** <input type="datetime-local"> value in the server's local time. */
export function localInput(d: Date | null) {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}