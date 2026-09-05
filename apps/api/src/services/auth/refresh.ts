import { and, eq, isNull } from 'drizzle-orm';
import { type Database, users, refreshTokens } from '@invoice-saas/db';
import { hashToken, generateSecureToken } from '../../lib/auth/tokens';
import { signAccessToken } from '../../lib/auth/jwt';
import { InvalidTokenError } from '../../lib/errors';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Rotates the refresh token on every use. If a *revoked* hash is presented
 * again, that's a reuse signal — the legitimate client already rotated past
 * it, so someone else has a copy. Response: revoke every refresh token for
 * that user, forcing re-login everywhere (identity-and-rbac/design.md).
 */
export async function refresh(db: Database, rawToken: string): Promise<RefreshResult> {
  const hash = hashToken(rawToken);
  const existing = await db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, hash) });

  if (!existing) {
    throw new InvalidTokenError('refresh');
  }

  if (existing.revokedAt) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, existing.userId), isNull(refreshTokens.revokedAt)));
    throw new InvalidTokenError('refresh');
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    throw new InvalidTokenError('refresh');
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, existing.userId) });
  if (!user) throw new InvalidTokenError('refresh');

  const next = generateSecureToken();

  await db.transaction(async (tx) => {
    await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, existing.id));
    await tx.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: next.hash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
  });

  return {
    accessToken: signAccessToken({ sub: user.id, platformRole: user.platformRole }),
    refreshToken: next.raw,
  };
}
