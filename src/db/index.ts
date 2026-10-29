import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Common base of the node-postgres and PGlite drivers, so services are driver-agnostic. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
/** Either the root database or a transaction handle — services accept both. */
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

const globalForDb = globalThis as unknown as { __campusDb?: Database };

/**
 * DATABASE_URL set  -> PostgreSQL via node-postgres (production / Neon / Supabase / RDS).
 * DATABASE_URL unset -> embedded PGlite (real Postgres compiled to WASM) persisted in ./.data.
 */
function createDb(): Database {
  const url = process.env.DATABASE_URL;
  if (url) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg") as typeof import("pg");
    // Always verify the server certificate (Neon and other managed hosts present valid certs).
    const connectionString = url.replace(/sslmode=(require|prefer|verify-ca)\b/, "sslmode=verify-full");
    const pool = new Pool({ connectionString, max: Number(process.env.DB_POOL_MAX ?? 10) });
    return drizzlePg(pool, { schema }) as unknown as Database;
  }
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_EMBEDDED_DB) {
    throw new Error("DATABASE_URL is required in production (set ALLOW_EMBEDDED_DB=1 to use embedded PGlite for demos).");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  mkdirSync(dir, { recursive: true });
  return drizzlePglite(new PGlite(dir), { schema }) as unknown as Database;
}

export function getDb(): Database {
  if (!globalForDb.__campusDb) globalForDb.__campusDb = createDb();
  return globalForDb.__campusDb;
}

/** Test hook: inject an in-memory database. */
export function setDb(db: Database) {
  globalForDb.__campusDb = db;
}

export { schema };
