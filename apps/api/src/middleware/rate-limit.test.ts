import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

describe('rate limiting on public endpoints', () => {
  it('should reject login attempts past the configured limit for one email+IP', async () => {
    const attempt = () => request(app).post('/api/v1/auth/login').send({ email: 'ratelimited@example.com', password: 'wrong-password' });

    // Limit is 10 per 15 min for /auth/login — the 11th should be rejected
    // with 429 regardless of credentials, before even reaching the auth logic.
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await attempt();
      lastStatus = res.status;
    }

    expect(lastStatus).toBe(429);
  });

  it('should track different emails independently under the same IP', async () => {
    // Exhaust the limit for one email...
    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/v1/auth/login').send({ email: 'exhausted@example.com', password: 'wrong' });
    }
    const exhausted = await request(app).post('/api/v1/auth/login').send({ email: 'exhausted@example.com', password: 'wrong' });
    expect(exhausted.status).toBe(429);

    // ...a different email from the same test-suite IP should still be allowed through.
    const fresh = await request(app).post('/api/v1/auth/login').send({ email: 'fresh-email@example.com', password: 'wrong' });
    expect(fresh.status).not.toBe(429);
  });
});
