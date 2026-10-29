import { AppError } from "@/lib/errors";
import { toCsv } from "@/lib/student-import";
import { loadTenantContext } from "@/server/context";
import { getSessionUser } from "@/server/session";
import { exportStudents } from "@/server/services/students";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  try {
    const ctx = await loadTenantContext(user, slug);
    const url = new URL(req.url);
    const q = Object.fromEntries(url.searchParams);
    const { rows, columns } = await exportStudents(ctx, { ...q, semester: q.semester ? Number(q.semester) : undefined, sort: q.sort as never });
    const csv = toCsv(rows, columns);
    return new Response("﻿" + csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-students-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.code === "not_found" ? 404 : 403 });
    throw e;
  }
}
