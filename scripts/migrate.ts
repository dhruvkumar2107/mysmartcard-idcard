// Migrations use the direct (unpooled) connection when available — DDL should not go through PgBouncer.
if (process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

async function main() {
  const { getDb } = await import("@/db");
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(getDb());
  console.log("Migrations applied.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
