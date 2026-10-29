import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { runMigrations } from "@/db/migrate";
import { institutions } from "@/db/schema";
import { COLLEGES, DEMO_PASSWORD, seedCollege } from "./seed-data";

async function main() {
  if ((process.env.NODE_ENV === "production" || process.env.DATABASE_URL) && !process.env.ALLOW_DEMO_SEED) {
    throw new Error(
      "Refusing to seed fictional demo data into a real database (DATABASE_URL is set). " +
        "Seed only the embedded local DB, or set ALLOW_DEMO_SEED=1 for a dedicated demo database/branch.",
    );
  }
  const db = getDb();
  await runMigrations(db);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(institutions);
  if (n > 0) {
    console.log(`Database already has ${n} college(s); skipping seed. Run "npm run db:reset" to start over (local only).`);
    return;
  }
  console.log("Seeding fictional demo data…");
  const results = [];
  for (const c of COLLEGES) {
    const t = Date.now();
    results.push(await seedCollege(c));
    console.log(`  ✓ ${c.name} (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }
  console.log(`\nDemo accounts (password for all: ${DEMO_PASSWORD})`);
  console.log("  Platform super admin: platform@mysmartcard.test");
  for (const r of results) {
    console.log(`\n  [${r.slug}]`);
    console.log(`    College admin : ${r.adminEmail}`);
    console.log(`    HOD           : ${r.hodEmail}`);
    console.log(`    Faculty       : ${r.facultyEmail}`);
    console.log(`    Student       : ${r.studentEmail}`);
    console.log(`    Sample NFC URL: ${r.sampleCard.url}  (${r.sampleCard.enrollmentNo})`);
    if (r.slug === "northbridge") console.log("    Also: principal@, accountant@, librarian@, transportadmin@northbridge.test");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
