import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index';

// A connection pool is a resource manager, not per-request state — sharing it
// is correct and standard. What architecture-principles.md #6 forbids is a
// module-level object that accumulates *request-scoped* data across calls;
// this pool never does that.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
export type Database = typeof db;
export type Schema = typeof schema;

// A transaction callback's `tx` is a PgTransaction, not a NodePgDatabase — it
// implements the same query-builder surface (select/insert/update/delete/
// query/transaction) but isn't structurally identical (no `$client`).
// Service functions that must work with either accept this union instead of
// `Database` alone.
export type DbOrTx = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export async function closeDb(): Promise<void> {
  await pool.end();
}
