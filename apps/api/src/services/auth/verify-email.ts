import { eq } from 'drizzle-orm';
import { type Database, emailVerificationTokens, users } from '@invoice-saas/db';
import { hashToken } from '../../lib/auth/tokens';
import { InvalidTokenError } from '../../lib/errors';

export async function verifyEmail(db: Database, rawToken: string): Promise<void> {
  const hash = hashToken(rawToken);
  const record = await db.query.emailVerificationTokens.findFirst({
    where: eq(emailVerificationTokens.tokenHash, hash),
  });

  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw new InvalidTokenError('verification');
  }

  await db.transaction(async (tx) => {
    await tx.update(emailVerificationTokens).set({ usedAt: new Date() }).where(eq(emailVerificationTokens.id, record.id));
    await tx.update(users).set({ isVerified: true }).where(eq(users.id, record.userId));
  });
}
