import type { NextFunction, Request, Response } from 'express';
import { getRedis } from '../lib/redis';
import { ApiHttpError } from '../lib/errors';

/**
 * Fixed-window rate limiter, Redis-backed so it works across multiple API
 * instances behind the ALB (tech.md). Applied to every public/unauthenticated
 * endpoint — login, signup, password reset, invitation acceptance, magic
 * links — per the hard requirement in steering/tech.md's "Rate limiting"
 * section. Fails OPEN if Redis is unreachable: a rate limiter that blocks
 * all traffic during a Redis outage would turn an availability blip into a
 * total outage, which is worse than temporarily unlimited requests.
 */
export function rateLimit(options: { keyPrefix: string; max: number; windowSeconds: number; keyFrom?: (req: Request) => string }) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const identity = options.keyFrom ? options.keyFrom(req) : req.ip;
      const key = `ratelimit:${options.keyPrefix}:${identity}`;

      const redis = getRedis();
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, options.windowSeconds);
      }

      if (count > options.max) {
        next(new ApiHttpError(429, 'rate_limited', 'Too many requests. Please try again later.'));
        return;
      }

      next();
    } catch {
      next(); // fail open — see the note above
    }
  };
}

/** Keys on email when the body has one (login/signup/forgot-password) —
 * combined with IP would let an attacker distribute attempts across many
 * emails from one IP, or many IPs against one email, to dodge either alone. */
export function rateLimitByEmailAndIp(keyPrefix: string, max: number, windowSeconds: number) {
  return rateLimit({
    keyPrefix,
    max,
    windowSeconds,
    keyFrom: (req) => `${req.ip}:${typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : 'unknown'}`,
  });
}
