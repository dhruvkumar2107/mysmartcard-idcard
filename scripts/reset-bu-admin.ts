/**
 * Set a new password for the Bangalore University college admin and print it once. Usage:
 *   npx tsx --env-file-if-exists=.env.local scripts/reset-bu-admin.ts
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, institutions } from "@/db/schema";
import { generateTempPassword } from "@/lib/crypto";
import { hashPassword } from "@/server/auth";

async function main() {
  const db = getDb();
  const email = "admin@bangaloreuniversity.test";
  const [inst] = await db.select({ name: institutions.name }).from(institutions).where(eq(institutions.slug, "bangalore-university"));
  if (!inst) throw new Error("bangalore-university not found in this database");
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!u) throw new Error(`${email} not found`);
  const password = generateTempPassword();
  await db.update(users).set({ passwordHash: await hashPassword(password), mustChangePassword: false }).where(eq(users.id, u.id));
  console.log(`${inst.name}\n  Email:    ${email}\n  Password: ${password}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
