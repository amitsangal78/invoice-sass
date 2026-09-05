import { describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { db, refreshTokens } from '@invoice-saas/db';
import { signup } from './signup';
import { login } from './login';
import { refresh } from './refresh';
import { InvalidTokenError } from '../../lib/errors';

async function signupAndLogin(email: string) {
  await signup(db, { email, password: 'correct-horse-1', workspaceName: 'A' });
  return login(db, { email, password: 'correct-horse-1' });
}

describe('refresh rotation + reuse detection', () => {
  it('should rotate the refresh token on every use, chaining through multiple sequential refreshes', async () => {
    const { refreshToken: first } = await signupAndLogin('rotate@example.com');

    const { refreshToken: second } = await refresh(db, first);
    expect(second).not.toBe(first);

    const { refreshToken: third } = await refresh(db, second);
    expect(third).not.toBe(second);
  });

  it('should reject a superseded (already-rotated-away) refresh token', async () => {
    const { refreshToken: first } = await signupAndLogin('superseded@example.com');
    await refresh(db, first); // rotates `first` away

    // Replaying the now-superseded token is itself a reuse attempt — see the
    // dedicated reuse-detection test below for what this does to the rest of
    // the session set.
    await expect(refresh(db, first)).rejects.toThrow(InvalidTokenError);
  });

  it('should revoke every refresh token for the user when a revoked token is reused', async () => {
    const { refreshToken: first, user } = await signupAndLogin('reuse@example.com');

    // Legitimate rotation.
    const { refreshToken: second } = await refresh(db, first);

    // An attacker (or a buggy client) replays the already-rotated-away token.
    await expect(refresh(db, first)).rejects.toThrow(InvalidTokenError);

    // The reuse response revokes the WHOLE session set — even the token that
    // rotation legitimately just issued must now be dead.
    await expect(refresh(db, second)).rejects.toThrow(InvalidTokenError);

    const activeTokens = await db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
    expect(activeTokens).toHaveLength(0);
  });

  it('should reject an unknown refresh token', async () => {
    await expect(refresh(db, 'not-a-real-token')).rejects.toThrow(InvalidTokenError);
  });
});
