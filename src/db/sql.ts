import { getTableName, sql, type Column } from "drizzle-orm";

/**
 * Fully-qualified column reference for correlated subqueries.
 * Drizzle omits the table qualifier in single-table selects, so `${t.id}` can
 * silently bind to the subquery's own `id` column. Always use `ref()` there.
 */
export const ref = (c: Column) => sql.raw(`"${getTableName(c.table)}"."${c.name}"`);
