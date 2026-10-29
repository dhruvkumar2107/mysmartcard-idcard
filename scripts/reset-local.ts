import { rm } from "node:fs/promises";
import path from "node:path";

// Local development only: deletes the embedded PGlite database and uploaded files.
async function main() {
  if (process.env.DATABASE_URL) {
    console.error("db:reset only works with the embedded local database. Refusing to touch DATABASE_URL.");
    process.exit(1);
  }
  const dir = path.join(process.cwd(), ".data");
  await rm(dir, { recursive: true, force: true });
  console.log(`Removed ${dir}`);
}

main();
