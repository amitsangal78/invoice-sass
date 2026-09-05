import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../lib/auth/jwt';
import { ApiHttpError } from '../lib/errors';

/** Verifies the access token's signature + expiry, sets req.user. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new ApiHttpError(401, 'unauthenticated', 'Missing or malformed Authorization header.'));
    return;
  }

  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length));
    req.user = { id: payload.sub, platformRole: payload.platformRole };
    next();
  } catch {
    next(new ApiHttpError(401, 'unauthenticated', 'Invalid or expired access token.'));
  }
}
