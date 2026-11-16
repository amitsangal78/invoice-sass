import pg from 'pg';
export type { PoolClient } from 'pg';
export const { Pool } = pg;
export type Database = InstanceType<typeof Pool>;

export function createDatabase(connectionString: string): Database {
  // For hosted PostgreSQL, supply a TLS-validating connection string/CA configuration.
  // Never disable certificate verification in code.
  return new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
}

export async function transaction<T>(db: Database, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function withTenant<T>(db: Database, vendorId: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return transaction(db, async client => {
    await client.query("SELECT set_config('app.vendor_id', $1, true)", [vendorId]);
    return work(client);
  });
}

export async function assertRuntimeRole(db: Database): Promise<void> {
  const { rows } = await db.query<{ rolsuper: boolean; rolbypassrls: boolean }>('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
  if (!rows[0] || rows[0].rolsuper || rows[0].rolbypassrls) throw new Error('API and worker require a non-superuser role without BYPASSRLS.');
}

export async function withPlatformOwner<T>(db: Database, userId: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return transaction(db, async client => {
    await client.query("SELECT set_config('app.platform_owner_id',$1,true)", [userId]);
    if (!(await client.query('SELECT is_platform_owner_context() AS allowed')).rows[0].allowed) {
      throw new Error('Verified platform owner required.');
    }
    return work(client);
  });
}

export async function withCapability<T>(db: Database, kind: 'link' | 'customer', hash: Buffer, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return transaction(db, async client => {
    const table = kind === 'link' ? 'invoice_access_links' : 'customer_sessions';
    await client.query('SELECT set_config($1,$2,true)', [`app.${kind}_token_hash`, hash.toString('hex')]);
    const row = (await client.query(`SELECT vendor_id FROM ${table} WHERE token_hash=$1`, [hash])).rows[0];
    if (row) await client.query("SELECT set_config('app.vendor_id',$1,true)", [row.vendor_id]);
    return work(client);
  });
}
