import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { files, institutions } from "@/db/schema";
import { loadTenantContext, type TenantContext } from "@/server/context";
import { getSessionUser } from "@/server/session";
import { isUuid } from "@/server/services/guard";
import { authorizeFile, fileResponse } from "@/server/services/file-access";

/**
 * Private file download. Authorization is decided per owner type — knowing a
 * file id is never enough.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return new Response("Not found", { status: 404 });
  const db = getDb();
  const [f] = await db.select({ file: files, slug: institutions.slug }).from(files).innerJoin(institutions, eq(institutions.id, files.institutionId)).where(eq(files.id, id)).limit(1);
  if (!f) return new Response("Not found", { status: 404 });

  const publicFile = f.file.ownerType === "branding";
  if (!publicFile) {
    const user = await getSessionUser();
    if (!user) return new Response("Sign in required", { status: 401 });
    let ctx: TenantContext;
    try {
      ctx = await loadTenantContext(user, f.slug);
    } catch {
      return new Response("Not found", { status: 404 });
    }
    if (!(await authorizeFile(ctx, f.file))) return new Response("Not found", { status: 404 });
  }
  return fileResponse(req, f.file, { publicCache: publicFile });
}
