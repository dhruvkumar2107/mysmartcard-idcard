"use server";

import { cookies } from "next/headers";
import { encrypt } from "@/lib/crypto";
import { list, str, userAction } from "../action";
import { addCollegeAdmin, createInstitution, resetCollegeAdminPassword, setInstitutionStatus, updateSubscription } from "../services/platform";

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
