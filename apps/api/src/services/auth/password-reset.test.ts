import { describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { db, refreshTokens, passwordResetTokens } from '@invoice-saas/db';
import { signup } from './signup';
import { login } from './login';
import { forgotPassword, resetPassword } from './password-reset';
import { generateSecureToken } from '../../lib/auth/tokens';
import { InvalidTokenError } from '../../lib/errors';
import { refresh } from './refresh';

describe('password reset revokes sessions', () => {
  it('should revoke every existing refresh token when the password is reset', async () => {
    const { userId } = await signup(db, { email: 'resetme@example.com', password: 'old-password-1', workspaceName: 'A' });
    const { refreshToken } = await login(db, { email: 'resetme@example.com', password: 'old-password-1' });

    const token = generateSecureToken();
    await db.insert(passwordResetTokens).values({ userId, tokenHash: token.hash, expiresAt: new Date(Date.now() + 60_000) });

    await resetPassword(db, token.raw, 'brand-new-password-1');

    // The refresh token issued before the reset must now be dead.
    await expect(refresh(db, refreshToken)).rejects.toThrow();

    const activeTokens = await db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    expect(activeTokens).toHaveLength(0);

    // The new password must actually work.
    const relogin = await login(db, { email: 'resetme@example.com', password: 'brand-new-password-1' });
    expect(relogin.accessToken).toBeTruthy();
  });

  it('should reject a reused or expired reset token', async () => {
    const { userId } = await signup(db, { email: 'resettoken@example.com', password: 'old-password-1', workspaceName: 'A' });
    const token = generateSecureToken();
    await db.insert(passwordResetTokens).values({ userId, tokenHash: token.hash, expiresAt: new Date(Date.now() - 1000) }); // already expired

    await expect(resetPassword(db, token.raw, 'new-password-1')).rejects.toThrow(InvalidTokenError);
  });

  it('should not reveal whether an email exists on forgot-password', async () => {
    await expect(forgotPassword(db, 'definitely-not-registered@example.com')).resolves.toBeUndefined();
  });
});
