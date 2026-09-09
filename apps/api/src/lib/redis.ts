import Redis from 'ioredis';
import { getEnv } from './env';

let client: Redis | undefined;

// Shared connection, not shared request state — see the same note in
// packages/db/src/client.ts.
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(getEnv().REDIS_URL, { maxRetriesPerRequest: 2 });
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = undefined;
  }
}

/**
 * Cache-aside read with a Postgres fallback baked in — if Redis is down or the
 * key is missing, falls through to `loadFresh` so the app degrades in
 * performance, never in correctness (tech.md's Redis conventions).
 */
export async function cacheAside<T>(key: string, ttlSeconds: number, loadFresh: () => Promise<T>): Promise<T> {
  try {
    const cached = await getRedis().get(key);
    if (cached !== null) return JSON.parse(cached) as T;
  } catch {
    // Redis unavailable — fall through to Postgres below.
  }

  const fresh = await loadFresh();

  try {
    await getRedis().set(key, JSON.stringify(fresh), 'EX', ttlSeconds);
  } catch {
    // Caching is best-effort; a write failure must not fail the request.
  }

  return fresh;
}

export async function invalidateCache(key: string): Promise<void> {
  try {
    await getRedis().del(key);
  } catch {
    // Best-effort — a stale cache entry expires via TTL regardless.
  }
}

/**
 * Invalidates every cache key matching a pattern — used when one action
 * (e.g. suspending a workspace) needs to invalidate a key per *member*
 * rather than a single known key. Uses non-blocking SCAN, not KEYS.
 * Best-effort: a miss here just means the affected keys expire via their
 * TTL instead (5-15 min), never a correctness gap — see
 * services/admin/manage-workspaces.ts for where this matters.
 */
export async function invalidateCachePattern(pattern: string): Promise<void> {
  try {
    const redis = getRedis();
    const keysToDelete: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keysToDelete.push(...keys);
    } while (cursor !== '0');

    if (keysToDelete.length > 0) await redis.del(...keysToDelete);
  } catch {
    // Best-effort — see the doc comment above.
  }
}
