import jwt from 'jsonwebtoken';
import { getEnv } from '../env';
import type { PlatformRole } from '@invoice-saas/db';

export interface AccessTokenPayload {
  sub: string; // user id
  platformRole: PlatformRole;
}

// 15-minute access token, minimal claims — no workspace/role embedded, per
// identity-and-rbac/design.md: authorization is resolved fresh per request
// from workspace_members, never trusted from a token claim.
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, getEnv().JWT_ACCESS_SECRET, { expiresIn: '15m' });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, getEnv().JWT_ACCESS_SECRET);
  if (typeof decoded === 'string' || !decoded.sub || !decoded.platformRole) {
    throw new Error('Malformed access token payload');
  }
  return { sub: decoded.sub, platformRole: decoded.platformRole as PlatformRole };
}
