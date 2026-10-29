/**
 * Create (or reset) a platform super admin. Usage:
 *   npm run admin:create -- you@example.com "Your Name"
 * Prints a generated one-time password once; the account must set its own password at first sign-in.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { generateTempPassword } from "@/lib/crypto";
import { hashPassword } from "@/server/auth";

async function main() {
  const [emailArg, ...nameParts] = process.argv.slice(2);
  const email = emailArg?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Usage: npm run admin:create -- you@example.com "Your Name"');
  const name = nameParts.join(" ").trim() || "Platform Administrator";
  const password = generateTempPassword();
  const passwordHash = await hashPassword(password);
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) await db.update(users).set({ passwordHash, isSuperAdmin: true, status: "active", mustChangePassword: true }).where(eq(users.id, existing.id));
  else await db.insert(users).values({ email, name, passwordHash, isSuperAdmin: true, mustChangePassword: true });
  console.log(`${existing ? "Reset" : "Created"} platform super admin\n  Email:    ${email}\n  Password: ${password}\n  (one-time — you will be asked to choose your own at first sign-in)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
