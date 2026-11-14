/**
 * Onboard the 10 showcase colleges, each with one student and a live NFC card link,
 * so the college panels and the tap-to-view ID cards can be demonstrated.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/seed-showcase-colleges.ts --yes [https://public-app-origin]
 *
 * Colleges whose slug already exists are skipped, so it is safe to re-run.
 * Every college admin login shares one freshly generated password, printed once and
 * saved with the panel and card links to .data/showcase-credentials.json (gitignored).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { cardTokens, institutions, users } from "@/db/schema";
import { hashPassword } from "@/server/auth";
import { decrypt, generateTempPassword } from "@/lib/crypto";
import { loadTenantContext } from "@/server/context";
import { createInstitution } from "@/server/services/platform";
import * as academics from "@/server/services/academics";
import * as studentsSvc from "@/server/services/students";
import { MODULE_KEYS } from "@/lib/portal-config";

type Showcase = {
  slug: string;
  shortName: string;
  name: string;
  address: string;
  city: string;
  pincode: string;
  student: string;
  course: string;
  dept: { code: string; name: string };
};

const SHOWCASE: Showcase[] = [
  { slug: "st-josephs-pu-vijayapur", shortName: "SJPUC", name: "St Joseph's PU College", address: "Solapur–Bangalore Bypass, near Rambhapur", city: "Vijayapur", pincode: "586104", student: "Aditya Deshmukh", course: "PU 1st Year", dept: { code: "PU", name: "Pre-University" } },
  { slug: "shree-guru-pu-kalaburagi", shortName: "SGIPUC", name: "Shree Guru Independent PU College", address: "Near Ram Mandir Circle, Jewargi Road", city: "Kalaburagi", pincode: "585103", student: "Nikhil Bhosale", course: "PU 1st Year", dept: { code: "PU", name: "Pre-University" } },
  { slug: "bldea-halakatti-cet", shortName: "BLDEACET", name: "BLDEA's V.P. Dr. P.G. Halakatti College of Engineering & Technology", address: "Ashram Road", city: "Vijayapur", pincode: "586101", student: "Ananya Patil", course: "BE 1st Year", dept: { code: "ENG", name: "Engineering" } },
  { slug: "shriram-dharamsingh-science", shortName: "SDCS", name: "Shriram Dharamsingh College of Science", address: "Old Jewargi Road, Ambedkar Nagar", city: "Kalaburagi", pincode: "585102", student: "Naveen Agarwal", course: "BSc 1st Year", dept: { code: "SCI", name: "Science" } },
  { slug: "pda-engineering-kalaburagi", shortName: "PDACE", name: "PDA College of Engineering", address: "Sharanbasaveshwar College Campus, Vidya Nagar", city: "Kalaburagi", pincode: "585103", student: "Ayaan Momin", course: "BE 1st Year", dept: { code: "ENG", name: "Engineering" } },
  { slug: "iqra-urdu-hps-bijapur", shortName: "IUHPS", name: "Iqra Urdu Higher Primary School", address: "Ward No. 1", city: "Bijapur", pincode: "586101", student: "Sumaiya Inamdar", course: "2nd Standard", dept: { code: "PRI", name: "Primary School" } },
  { slug: "ksawu-vijayapur", shortName: "KSAWU", name: "Karnataka State Akkamahadevi Women's University", address: "Jnanashakti Campus, Torvi", city: "Vijayapur", pincode: "586108", student: "Mahira Patel", course: "MBA 1st Year", dept: { code: "MGT", name: "Management" } },
  { slug: "al-badar-education-gulbarga", shortName: "ABCE", name: "Al Badar College of Education", address: "MSK Mills Road, near Central Bus Stand", city: "Gulbarga", pincode: "585102", student: "Imran Khan Risaldar", course: "BEd 1st Year", dept: { code: "EDU", name: "Education" } },
  { slug: "al-ameen-medical-vijayapur", shortName: "AAMCRC", name: "Al Ameen Medical College & Research Centre", address: "Athani Road", city: "Vijayapur", pincode: "586101", student: "Priti Naik", course: "MBBS 1st Year", dept: { code: "MED", name: "Medicine" } },
  { slug: "bldea-sb-arts-kcp-science", shortName: "BLDEASB", name: "BLDEA's S.B. Arts & K.C.P. Science College", address: "Shri B.M. Patil Road, New Campus", city: "Vijayapur", pincode: "586103", student: "Neha Kulkarni", course: "BSc 1st Year", dept: { code: "SCI", name: "Science" } },
];

const YEAR = "2026-27";

async function main() {
  if (!process.argv.includes("--yes")) throw new Error("This onboards 10 colleges into the configured database. Re-run with --yes to proceed.");
  const db = getDb();
  const [actor] = await db.select().from(users).where(eq(users.isSuperAdmin, true)).limit(1);
  if (!actor) throw new Error("No platform super admin exists. Create one with npm run admin:create first.");
  // Card tokens are stored encrypted with APP_SECRET; a mismatched secret would make the new links unreadable in the panel.
  const [sample] = await db.select({ enc: cardTokens.tokenEncrypted }).from(cardTokens).limit(1);
  if (sample?.enc) {
    try {
      decrypt(sample.enc);
    } catch {
      throw new Error("APP_SECRET does not match the one this database was created with. Use the production APP_SECRET.");
    }
  }
  const origin = process.argv.find((a) => a.startsWith("https://"))?.replace(/\/$/, "") ?? null;
  const link = (u: string) => (origin ? origin + new URL(u).pathname : u);
  const password = generateTempPassword();
  const passwordHash = await hashPassword(password);
  const out: { college: string; slug: string; admin: string; student: string; url: string | null }[] = [];

  for (const c of SHOWCASE) {
    const [clash] = await db.select({ id: institutions.id }).from(institutions).where(eq(institutions.slug, c.slug));
    if (clash) {
      console.log(`skip  ${c.name} (already exists)`);
      continue;
    }
    const adminEmail = `admin@${c.slug}.mysmartcard.test`;
    await createInstitution(actor, {
      name: c.name,
      shortName: c.shortName,
      slug: c.slug,
      address: c.address,
      city: c.city,
      state: "Karnataka",
      pincode: c.pincode,
      plan: "enterprise",
      licensedModules: MODULE_KEYS,
      studentLimit: 5000,
      adminName: `${c.shortName} Administrator`,
      adminEmail,
    });
    await db.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.email, adminEmail));
    const [admin] = await db.select().from(users).where(eq(users.email, adminEmail));
    const ctx = await loadTenantContext(admin, c.slug);

    const dep = await academics.createDepartment(ctx, c.dept);
    const prog = await academics.createProgramme(ctx, { departmentId: dep.id, code: c.course.replace(/[^A-Za-z0-9]+/g, "").toUpperCase().slice(0, 12), name: c.course, durationSemesters: 8 });
    const sec = await academics.createSection(ctx, { programmeId: prog.id, semester: 1, name: "A", academicYear: YEAR });
    const s = await studentsSvc.createStudent(ctx, {
      enrollmentNo: `${c.shortName}26001`,
      fullName: c.student,
      email: null,
      phone: null,
      dateOfBirth: null,
      gender: null,
      guardianName: null,
      guardianPhone: null,
      address: null,
      bloodGroup: null,
      departmentId: dep.id,
      programmeId: prog.id,
      sectionId: sec.id,
      semester: 1,
      academicYear: YEAR,
      admissionYear: 2026,
      status: "active",
    });
    out.push({ college: c.name, slug: c.slug, admin: adminEmail, student: c.student, url: s.cardUrl && link(s.cardUrl) });
    console.log(`done  ${c.name}`);
  }

  if (!out.length) return console.log("Nothing new to create.");
  mkdirSync(".data", { recursive: true });
  writeFileSync(".data/showcase-credentials.json", JSON.stringify({ site: origin, password, colleges: out.map((r) => ({ ...r, panel: `${origin ?? ""}/c/${r.slug}/admin` })) }, null, 2));
  console.log(`\nPassword for every college admin login below: ${password}\n`);
  for (const r of out) {
    console.log(`${r.college}`);
    console.log(`  Panel   : ${origin ?? ""}/c/${r.slug}/admin   (login ${r.admin})`);
    console.log(`  Student : ${r.student}`);
    console.log(`  NFC card: ${r.url}\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
