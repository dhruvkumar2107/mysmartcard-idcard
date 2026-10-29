/**
 * Seed a large demonstration university (1,000 fictional students with
 * academics, attendance, marks, fees, library, transport and NFC cards) into
 * the configured database, onboarded by an existing platform super admin.
 *
 *   npm run demo:university -- --yes [https://public-app-origin]
 *
 * Every seeded login shares one freshly generated password, printed once.
 * Refuses to run if the college already exists.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { institutions, users } from "@/db/schema";
import { generateTempPassword } from "@/lib/crypto";
import { seedCollege, type CollegeSpec } from "./seed-data";

export const BANGALORE_UNIVERSITY: CollegeSpec = {
  slug: "bangalore-university",
  name: "Bangalore University",
  shortName: "BU",
  city: "Bengaluru",
  domain: "bangaloreuniversity.test",
  seed: 560056,
  sectionsPerDepartment: 4,
  studentsPerSection: 50,
  rich: true,
  portalStudents: 10,
  libraryLoans: 80,
  transportStudents: 240,
  concurrency: 8,
  firstNames: [
    "Abhishek", "Bhavana", "Chethan", "Deepika", "Darshan", "Gagan", "Harsha", "Keerthana", "Kavya", "Manjunath",
    "Nandini", "Prajwal", "Pavan", "Rakshitha", "Shreyas", "Spoorthi", "Sinchana", "Tejas", "Varsha", "Yashwanth",
    "Aditi", "Akash", "Ananya", "Bharath", "Chaitra", "Divya", "Girish", "Hemanth", "Ishwarya", "Kiran",
    "Lavanya", "Mahesh", "Meghana", "Naveen", "Pooja", "Pranav", "Rahul", "Ramya", "Sahana", "Sanjay",
    "Shwetha", "Sneha", "Suhas", "Sushma", "Tanvi", "Vinay", "Vishnu", "Akshatha", "Rohith", "Nisha",
  ],
  lastNames: [
    "Gowda", "Shetty", "Hegde", "Kulkarni", "Rao", "Murthy", "Bhat", "Naik", "Patil", "Reddy",
    "Prasad", "Kumar", "Shastry", "Achar", "Desai", "Iyengar", "Nayak", "Kamath", "Pai", "Joshi",
    "Rai", "Shenoy", "Swamy", "Gupta", "Menon", "Nair", "Sharma", "Hiremath", "Angadi", "Kotian",
  ],
  streets: [
    "Jnanabharathi Main Road", "Nagarbhavi 2nd Stage", "Vijayanagar", "Rajajinagar 4th Block", "Basavanagudi",
    "Jayanagar 9th Block", "Malleshwaram 8th Cross", "Banashankari 3rd Stage", "Kengeri Satellite Town", "RR Nagar",
  ],
  departments: [
    {
      code: "CS",
      name: "Department of Computer Science",
      programme: { code: "BCA", name: "Bachelor of Computer Applications" },
      subjects: [
        { code: "BCA301", name: "Data Structures", credits: 4, kind: "theory" },
        { code: "BCA302", name: "Operating Systems", credits: 4, kind: "theory" },
        { code: "BCA303L", name: "Python Programming Lab", credits: 2, kind: "lab" },
      ],
    },
    {
      code: "COM",
      name: "Department of Commerce",
      programme: { code: "BCOM", name: "Bachelor of Commerce" },
      subjects: [
        { code: "BC301", name: "Corporate Accounting", credits: 4, kind: "theory" },
        { code: "BC302", name: "Business Law", credits: 3, kind: "theory" },
        { code: "BC303", name: "Income Tax", credits: 3, kind: "theory" },
      ],
    },
    {
      code: "MGT",
      name: "Department of Business Administration",
      programme: { code: "BBA", name: "Bachelor of Business Administration" },
      subjects: [
        { code: "BBA301", name: "Marketing Management", credits: 4, kind: "theory" },
        { code: "BBA302", name: "Human Resource Management", credits: 3, kind: "theory" },
        { code: "BBA303L", name: "Business Analytics Lab", credits: 2, kind: "lab" },
      ],
    },
    {
      code: "PHY",
      name: "Department of Physics",
      programme: { code: "BSC-PCM", name: "B.Sc Physics, Chemistry, Mathematics" },
      subjects: [
        { code: "PH301", name: "Electricity & Magnetism", credits: 4, kind: "theory" },
        { code: "PH302", name: "Optics", credits: 3, kind: "theory" },
        { code: "PH303L", name: "Physics Practical III", credits: 2, kind: "lab" },
      ],
    },
    {
      code: "ART",
      name: "Department of Arts",
      programme: { code: "BA-HEP", name: "B.A. History, Economics, Political Science" },
      subjects: [
        { code: "BA301", name: "Indian Economy", credits: 4, kind: "theory" },
        { code: "BA302", name: "Modern Indian History", credits: 4, kind: "theory" },
        { code: "BA303", name: "Kannada Language III", credits: 3, kind: "theory" },
      ],
    },
  ],
};

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--yes")) throw new Error("This writes ~1,000 demo students to the configured database. Re-run with --yes to proceed.");
  const origin = args.find((a) => a.startsWith("https://"))?.replace(/\/$/, "") ?? null;
  const db = getDb();
  const [clash] = await db.select({ id: institutions.id }).from(institutions).where(eq(institutions.slug, BANGALORE_UNIVERSITY.slug));
  if (clash) throw new Error(`College "${BANGALORE_UNIVERSITY.slug}" already exists; nothing was changed.`);
  const [actor] = await db.select().from(users).where(eq(users.isSuperAdmin, true)).limit(1);
  if (!actor) throw new Error("No platform super admin exists. Create one with npm run admin:create first.");

  const password = generateTempPassword();
  const t0 = Date.now();
  const log = (m: string) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);
  console.log(`Seeding ${BANGALORE_UNIVERSITY.name} as ${actor.email}…`);
  const r = await seedCollege(BANGALORE_UNIVERSITY, { actor, password, log });
  const link = (url: string) => (origin ? origin + new URL(url).pathname : url);
  const d = BANGALORE_UNIVERSITY.domain;

  console.log(`\nDone in ${((Date.now() - t0) / 60000).toFixed(1)} min. Password for every login below: ${password}`);
  console.log(`  College admin  : ${r.adminEmail}`);
  console.log(`  Principal      : principal@${d}`);
  console.log(`  Accounts       : accountant@${d}`);
  console.log(`  Librarian      : librarian@${d}`);
  console.log(`  Transport      : transportadmin@${d}`);
  console.log(`  HOD            : ${r.hodEmail}`);
  console.log(`  Faculty        : ${r.facultyEmail}`);
  for (const p of r.portalLogins) console.log(`  Student        : ${p.email}  (${p.enrollmentNo})`);
  console.log("  Sample NFC card links:");
  for (const c of r.sampleCards) console.log(`    ${c.enrollmentNo}  ${link(c.url)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
