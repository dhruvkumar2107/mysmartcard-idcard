import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { files, students } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";
import { storage } from "@/lib/storage";
import { resolveCardToken } from "@/server/services/cards";

/** Photo for the public tap page — served only if the token is live AND the college made photos public. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await rateLimit(`cardphoto:${ip}`, 60, 60_000)).ok) return new Response("Too many requests", { status: 429 });
  const view = await resolveCardToken(token, { countTap: false });
  if (view.state !== "ok" || !view.photoAvailable) return new Response("Not found", { status: 404 });
  const [s] = await getDb().select({ photoFileId: students.photoFileId }).from(students).where(eq(students.id, view.studentId)).limit(1);
  if (!s?.photoFileId) return new Response("Not found", { status: 404 });
  const [f] = await getDb().select().from(files).where(eq(files.id, s.photoFileId)).limit(1);
  if (!f || f.ownerType !== "student_photo") return new Response("Not found", { status: 404 });
  const body = await storage().get(f.storageKey);
  return new Response(new Uint8Array(body), { headers: { "Content-Type": f.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
