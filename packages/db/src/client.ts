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

export async function closeDb(): Promise<void> {
  await pool.end();
}
