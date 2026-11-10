/**
 * Issue NFC card links for every active student (in every college) who does not have a live card yet.
 * Safe to re-run: students who already have a card are skipped. Usage:
 *   npx tsx --env-file-if-exists=.env.local scripts/issue-card-links.ts
 */
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { institutions, students, users } from "@/db/schema";
import { audit } from "@/server/audit";
import type { TenantContext } from "@/server/context";
import { issueStudentCards } from "@/server/services/cards";

async function main() {
  const db = getDb();
  const [actor] = await db.select().from(users).where(eq(users.isSuperAdmin, true)).limit(1);
  if (!actor) throw new Error("No platform super admin found to attribute the card issue to.");
  const colleges = await db.select().from(institutions).orderBy(institutions.name);
  let total = 0;
  for (const inst of colleges) {
    const ctx = { user: actor, institution: inst, viaSupport: false, viaPlatform: true } as unknown as TenantContext & { viaPlatform: true };
    const list = await db
      .select({ id: students.id, enrollmentNo: students.enrollmentNo, academicYear: students.academicYear })
      .from(students)
      .where(and(eq(students.institutionId, inst.id), ne(students.status, "archived")));
    const n = await db.transaction(async (tx) => {
      const urls = await issueStudentCards(ctx, list, tx);
      if (urls.size) await audit(ctx, { action: "card.issue", entityType: "nfc_card", summary: `Issued ${urls.size} digital card link(s) for existing students` }, tx);
      return urls.size;
    });
    total += n;
    console.log(`${inst.name}: ${n} new link(s), ${list.length - n} already had a card`);
  }
  console.log(`Done. ${total} card link(s) issued.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
