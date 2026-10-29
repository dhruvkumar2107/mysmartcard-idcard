import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { Database } from "./index";

const migrationsFolder = path.join(process.cwd(), "drizzle");

/** Apply SQL migrations from ./drizzle. `driver` defaults to whatever getDb() would use. */
export async function runMigrations(db: Database, driver: "pg" | "pglite" = process.env.DATABASE_URL ? "pg" : "pglite") {
  if (driver === "pg") {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db as NodePgDatabase<never>, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as PgliteDatabase<never>, { migrationsFolder });
  }
}
