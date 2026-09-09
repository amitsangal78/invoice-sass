import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // memjs' server-list format, not a URL — "host:port" (comma-separated for a cluster).
  MEMCACHED_SERVERS: z.string().default('localhost:11211'),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_PEPPER: z.string().min(16), // mixed into refresh-token hashing, not the JWT itself (refresh tokens are opaque, not JWTs)
  PORT: z.coerce.number().default(4000),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).default('test-razorpay-webhook-secret'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).default('test-stripe-webhook-secret'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

// Lazily parsed and memoized — never re-read per request. This is configuration,
// not per-request state, so caching it doesn't violate the no-shared-mutable-
// globals principle (architecture-principles.md #6).
export function getEnv(): Env {
  if (!cached) {
    cached = envSchema.parse(process.env);
  }
  return cached;
}
