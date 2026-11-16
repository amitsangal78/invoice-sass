import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './index';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required; never run migrations using the API runtime connection.');
const db = createDatabase(url);
const client = await db.connect();
try {
  await client.query("SELECT pg_advisory_lock(hashtext('invoice-schema-migrations'))");
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) {
    if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount) continue;
    await client.query('BEGIN');
    try {
      await client.query(await readFile(`${dir}/${name}`, 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('invoice-schema-migrations'))");
  client.release(); await db.end();
}
