import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { files, institutions } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { cardTenantContext } from "@/server/context";
import { resolveCardToken } from "@/server/services/cards";
import { authorizeFile, fileResponse } from "@/server/services/file-access";
import { isUuid } from "@/server/services/guard";

/**
 * Files shown on an NFC card link (photo, timetable, notice and coursework attachments).
 * The live card token stands in for the student's session, with the same per-file checks.
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await rateLimit(`cardfile:${ip}`, 120, 60_000)).ok) return new Response("Too many requests", { status: 429 });
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const view = await resolveCardToken(token, { countTap: false });
  if (view.state !== "ok") return new Response("Not found", { status: 404 });

  const db = getDb();
  const [f] = await db.select().from(files).where(and(eq(files.id, id), eq(files.institutionId, view.institutionId))).limit(1);
  if (!f) return new Response("Not found", { status: 404 });
  if (f.ownerType !== "branding") {
    const [inst] = await db.select().from(institutions).where(eq(institutions.id, view.institutionId)).limit(1);
    if (!inst || !(await authorizeFile(await cardTenantContext(inst, view.studentId), f))) return new Response("Not found", { status: 404 });
  }
  return fileResponse(req, f, { publicCache: f.ownerType === "branding" });
}
