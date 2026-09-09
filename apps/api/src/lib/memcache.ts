import { Client as MemjsClient } from 'memjs';
import { getEnv } from './env';

let client: MemjsClient | undefined;

// Shared connection, not shared request state — see the same note in
// lib/redis.ts and packages/db/src/client.ts.
export function getMemcache(): MemjsClient {
  if (!client) {
    client = MemjsClient.create(getEnv().MEMCACHED_SERVERS);
  }
  return client;
}

export function closeMemcache(): void {
  if (client) {
    client.close();
    client = undefined;
  }
}

/**
 * Same cache-aside-with-Postgres-fallback contract as `cacheAside` in
 * lib/redis.ts, backed by Memcached instead. Reserved for content that's
 * immutable once created and can safely live for days, not hours — see
 * tech.md's Memcached conventions. Values are stored as UTF-8 strings, so a
 * caller with binary data (e.g. a PDF buffer) base64-encodes it first (see
 * services/invoicing/invoices.ts's getInvoicePdf for the pattern).
 */
export async function cacheAsideLong<T>(key: string, ttlSeconds: number, loadFresh: () => Promise<T>): Promise<T> {
  try {
    const { value } = await getMemcache().get(key);
    if (value !== null) return JSON.parse(value.toString('utf8')) as T;
  } catch {
    // Memcached unavailable — fall through to the real source below.
  }

  const fresh = await loadFresh();

  try {
    await getMemcache().set(key, JSON.stringify(fresh), { expires: ttlSeconds });
  } catch {
    // Caching is best-effort; a write failure must not fail the request.
  }

  return fresh;
}

export async function invalidateLongCache(key: string): Promise<void> {
  try {
    await getMemcache().delete(key);
  } catch {
    // Best-effort — a stale entry still expires via its TTL.
  }
}
