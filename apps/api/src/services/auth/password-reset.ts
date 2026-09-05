import { eq } from 'drizzle-orm';
import { type Database, users, passwordResetTokens } from '@invoice-saas/db';
import { generateSecureToken, hashToken } from '../../lib/auth/tokens';
import { hashPassword } from '../../lib/auth/password';
import { sendEmail } from '../../lib/email';
import { InvalidTokenError } from '../../lib/errors';
import { logoutAll } from './logout';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Always resolves — never reveals whether the email exists (no account enumeration). */
export async function forgotPassword(db: Database, email: string): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) return;

  const token = generateSecureToken();
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: token.hash,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });

  await sendEmail(email, 'Reset your Billify password', `Reset your password: /auth/reset-password?token=${token.raw}`);
}

/**
 * Resetting a password revokes every refresh token for the user — a forced
 * re-login on every other device is the correct security posture after a
 * credential reset (identity-and-rbac/design.md).
 */
export async function resetPassword(db: Database, rawToken: string, newPassword: string): Promise<void> {
  const hash = hashToken(rawToken);
  const record = await db.query.passwordResetTokens.findFirst({ where: eq(passwordResetTokens.tokenHash, hash) });

  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    throw new InvalidTokenError('password reset');
  }

  const passwordHash = await hashPassword(newPassword);

  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, record.userId));
    await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, record.id));
  });

  await logoutAll(db, record.userId);
}
