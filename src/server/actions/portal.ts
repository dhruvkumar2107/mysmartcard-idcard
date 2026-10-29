"use server";

import { optStr, str, tenantAction } from "../action";
import { submitAssignment } from "../services/coursework";
import { moduleVisibleToStudent } from "@/lib/portal-config";
import { forbidden } from "@/lib/errors";
import { viewerForStudent, portalStudent } from "../services/portal";

export async function submitAssignmentAction(fd: FormData) {
  return tenantAction(fd, async (ctx) => {
    const v = await viewerForStudent(ctx);
    const me = await portalStudent(v);
    if (!moduleVisibleToStudent(v.config, "coursework", me.student)) throw forbidden("Assignments are not enabled in your portal.");
    await submitAssignment(ctx, str(fd, "courseworkId"), fd.get("file") as File, optStr(fd, "note"));
    return "Submission uploaded.";
  });
}
