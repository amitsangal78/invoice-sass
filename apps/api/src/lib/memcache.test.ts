import { describe, expect, it, vi } from 'vitest';
import { cacheAsideLong, getMemcache } from './memcache';

describe('cacheAsideLong', () => {
  it('should call loadFresh once and serve the second call from cache', async () => {
    const loadFresh = vi.fn(async () => ({ value: 'first-load' }));
    const key = `test:cacheAsideLong:${crypto.randomUUID()}`;

    const first = await cacheAsideLong(key, 30, loadFresh);
    const second = await cacheAsideLong(key, 30, loadFresh);

    expect(first).toEqual({ value: 'first-load' });
    expect(second).toEqual({ value: 'first-load' });
    expect(loadFresh).toHaveBeenCalledTimes(1);
  });

  it('should call loadFresh again for a different key', async () => {
    const loadFresh = vi.fn(async () => 'fresh-value');
    const keyA = `test:cacheAsideLong:${crypto.randomUUID()}`;
    const keyB = `test:cacheAsideLong:${crypto.randomUUID()}`;

    await cacheAsideLong(keyA, 30, loadFresh);
    await cacheAsideLong(keyB, 30, loadFresh);

    expect(loadFresh).toHaveBeenCalledTimes(2);
  });

  it('should degrade to loadFresh on every call, not throw, when Memcached is failing', async () => {
    // Simulated at the client boundary rather than by pointing at a dead port:
    // getEnv() memoizes on first read, so reassigning process.env here would
    // be a no-op and the "unreachable" server would silently still be the
    // real one — making the assertion below pass for the wrong reason.
    const client = getMemcache();
    const getSpy = vi.spyOn(client, 'get').mockRejectedValue(new Error('memcached down'));
    const setSpy = vi.spyOn(client, 'set').mockRejectedValue(new Error('memcached down'));

    try {
      const loadFresh = vi.fn(async () => 'fallback-value');
      const key = `test:failing:${crypto.randomUUID()}`;

      const first = await cacheAsideLong(key, 30, loadFresh);
      const second = await cacheAsideLong(key, 30, loadFresh);

      expect(first).toBe('fallback-value');
      expect(second).toBe('fallback-value');
      // Nothing was cacheable, so every call recomputes — degraded in
      // performance, never in correctness, and never throwing.
      expect(loadFresh).toHaveBeenCalledTimes(2);
    } finally {
      getSpy.mockRestore();
      setSpy.mockRestore();
    }
  });

  it('should expire a key after its TTL', async () => {
    const loadFresh = vi.fn(async () => 'short-lived');
    const key = `test:cacheAsideLong:ttl:${crypto.randomUUID()}`;

    await cacheAsideLong(key, 1, loadFresh);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await cacheAsideLong(key, 1, loadFresh);

    expect(loadFresh).toHaveBeenCalledTimes(2);
  });
});

describe('getMemcache', () => {
  it('should return the same client instance on repeated calls', () => {
    expect(getMemcache()).toBe(getMemcache());
  });
});
