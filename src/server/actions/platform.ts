"use server";

import { cookies } from "next/headers";
import { encrypt } from "@/lib/crypto";
import { list, str, userAction } from "../action";
import { addCollegeAdmin, createInstitution, enterWorkspace, resetCollegeAdminPassword, setInstitutionStatus, updateInstitutionDetails, updateSubscription } from "../services/platform";
import * as builder from "../services/portal-builder";

/** Credentials are shown once on the next page via a short-lived encrypted httpOnly cookie, never in the URL. */
async function stash(msg: string) {
  (await cookies()).set("msc_onetime", encrypt(msg), { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/platform", maxAge: 300 });
}

export async function createInstitutionAction(fd: FormData) {
  return userAction(fd, "/platform/colleges/new", async (user) => {
    const res = await createInstitution(user, {
      name: str(fd, "name"),
      shortName: str(fd, "shortName"),
      slug: str(fd, "slug"),
      city: str(fd, "city") || null,
      contactEmail: str(fd, "contactEmail") || null,
      plan: str(fd, "plan") as "standard",
      licensedModules: list(fd, "modules"),
      studentLimit: Number(str(fd, "studentLimit")),
      adminName: str(fd, "adminName"),
      adminEmail: str(fd, "adminEmail"),
      adminPassword: str(fd, "adminPassword") || null,
    });
    await stash(res.tempPassword ? `College admin login — ${res.adminEmail} / ${res.tempPassword}` : `${res.adminEmail} already had an account and was added as college admin (existing password unchanged).`);
    return { message: `${res.institution.name} onboarded.`, to: `/platform/colleges/${res.institution.id}` };
  });
}

export async function setInstitutionStatusAction(fd: FormData) {
  return userAction(fd, "/platform", async (user) => {
    const status = str(fd, "status") === "active" ? "active" : "suspended";
    await setInstitutionStatus(user, str(fd, "id"), status, str(fd, "reason"));
    return status === "active" ? "College activated." : "College suspended. Its users can no longer sign in to the workspace and its NFC cards show as inactive.";
  });
}

export async function updateSubscriptionAction(fd: FormData) {
  return userAction(fd, "/platform", async (user) => {
    await updateSubscription(user, str(fd, "id"), { plan: str(fd, "plan"), licensedModules: list(fd, "modules"), studentLimit: Number(str(fd, "studentLimit")) });
    return "Subscription updated.";
  });
}

export async function updateInstitutionDetailsAction(fd: FormData) {
  return userAction(fd, "/platform", async (user) => {
    await updateInstitutionDetails(user, str(fd, "id"), { name: str(fd, "name"), shortName: str(fd, "shortName"), city: str(fd, "city") || null, contactEmail: str(fd, "contactEmail") || null });
    return "College details updated.";
  });
}

export async function addCollegeAdminAction(fd: FormData) {
  return userAction(fd, "/platform", async (user) => {
    const res = await addCollegeAdmin(user, str(fd, "id"), { name: str(fd, "name"), email: str(fd, "email"), password: str(fd, "password") || null });
    await stash(res.password ? `College admin login — ${res.email} / ${res.password}` : `${res.email} already had an account; it is now a college admin (existing password unchanged).`);
    return "College administrator added.";
  });
}

export async function resetAdminPasswordAction(fd: FormData) {
  return userAction(fd, "/platform", async (user) => {
    const res = await resetCollegeAdminPassword(user, str(fd, "id"), str(fd, "userId"), str(fd, "password") || null);
    await stash(`New login for ${res.email} / ${res.password}`);
    return "Password reset. The administrator must choose a new password at first sign-in; their existing sessions were signed out.";
  });
}

// ---------------------------------------------------------------- Portal Builder (super admin only)

const builderBack = (id: string | null, tab = "visibility") => `/platform/portal?college=${id ?? "global"}&tab=${tab}`;
const collegeOrNull = (fd: FormData) => {
  const id = str(fd, "college");
  return id && id !== "global" ? id : null;
};

export async function savePortalPolicyAction(fd: FormData) {
  return userAction(fd, "/platform/portal", async (user) => {
    const id = collegeOrNull(fd);
    const policy = builder.policyFromForm(fd);
    const publish = str(fd, "intent") === "publish";
    if (id) {
      const branding = str(fd, "primaryColor") ? { primaryColor: str(fd, "primaryColor"), accentColor: str(fd, "accentColor"), welcomeMessage: str(fd, "welcomeMessage") } : undefined;
      await builder.saveCollegeDraft(user, id, policy, branding);
      const logo = fd.get("logo");
      if (logo instanceof File && logo.size > 0) await builder.uploadCollegeLogo(user, id, logo);
      if (publish) await builder.publishCollege(user, id);
    } else {
      await builder.saveGlobalDraft(user, policy);
      if (publish) await builder.publishGlobal(user);
    }
    return { message: publish ? "Published. Students see the change on their next page load." : "Draft saved. Preview it, then publish.", to: builderBack(id, str(fd, "tab") || "visibility") };
  });
}

export async function publishPortalPolicyAction(fd: FormData) {
  return userAction(fd, "/platform/portal", async (user) => {
    const id = collegeOrNull(fd);
    if (id) await builder.publishCollege(user, id);
    else await builder.publishGlobal(user);
    return "Published.";
  });
}

export async function discardPortalPolicyAction(fd: FormData) {
  return userAction(fd, "/platform/portal", async (user) => {
    const id = collegeOrNull(fd);
    if (id) await builder.discardCollegeDraft(user, id);
    else await builder.discardGlobalDraft(user);
    return "Draft discarded.";
  });
}

export async function rollbackPortalPolicyAction(fd: FormData) {
  return userAction(fd, "/platform/portal", async (user) => {
    const id = await builder.rollbackTo(user, str(fd, "historyId"));
    return { message: "Version restored and published.", to: builderBack(id, "history") };
  });
}

/** Opening a college workspace from the platform is recorded in that college's audit log. */
export async function enterWorkspaceAction(fd: FormData) {
  return userAction(fd, "/platform", async (user) => {
    const inst = await enterWorkspace(user, str(fd, "id"));
    return { to: `/c/${inst.slug}/admin` };
  });
}
