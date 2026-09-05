import { and, eq, isNull } from 'drizzle-orm';
import { type Database, refreshTokens } from '@invoice-saas/db';
import { hashToken } from '../../lib/auth/tokens';

export async function logout(db: Database, rawToken: string): Promise<void> {
  const hash = hashToken(rawToken);
  // Idempotent — logging out an already-revoked/unknown token is not an error.
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, hash));
}

export async function logoutAll(db: Database, userId: string): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
