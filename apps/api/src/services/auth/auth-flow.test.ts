import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, users, emailVerificationTokens, workspaceMembers } from '@invoice-saas/db';
import { signup } from './signup';
import { login } from './login';
import { verifyEmail } from './verify-email';
import { generateSecureToken } from '../../lib/auth/tokens';
import { InvalidCredentialsError, InvalidTokenError } from '../../lib/errors';

describe('signup → verify → login', () => {
  it('should create a workspace with the signer as ADMIN and owner when signing up', async () => {
    const result = await signup(db, { email: 'amit@example.com', password: 'correct-horse-1', workspaceName: 'Amit Consulting' });

    const membership = await db.query.workspaceMembers.findFirst({ where: eq(workspaceMembers.workspaceId, result.workspaceId) });
    expect(membership?.role).toBe('ADMIN');
    expect(membership?.userId).toBe(result.userId);
  });

  it('should reject signup when the email is already taken', async () => {
    await signup(db, { email: 'dupe@example.com', password: 'correct-horse-1', workspaceName: 'A' });
    await expect(signup(db, { email: 'dupe@example.com', password: 'correct-horse-2', workspaceName: 'B' })).rejects.toThrow(/already exists/);
  });

  it('should mark the user verified when a valid verification token is used', async () => {
    await signup(db, { email: 'verify@example.com', password: 'correct-horse-1', workspaceName: 'A' });
    const user = await db.query.users.findFirst({ where: eq(users.email, 'verify@example.com') });
    expect(user!.isVerified).toBe(false);

    // signup() only persists the token's hash (the raw value only ever goes
    // out via email) — insert a fresh token directly here to exercise
    // verifyEmail() with a raw value this test controls.
    const token = generateSecureToken();
    await db.insert(emailVerificationTokens).values({ userId: user!.id, tokenHash: token.hash, expiresAt: new Date(Date.now() + 1000 * 60) });

    await verifyEmail(db, token.raw);

    const updated = await db.query.users.findFirst({ where: eq(users.id, user!.id) });
    expect(updated!.isVerified).toBe(true);
  });

  it('should reject an already-used verification token', async () => {
    await signup(db, { email: 'reuse@example.com', password: 'correct-horse-1', workspaceName: 'A' });
    const user = await db.query.users.findFirst({ where: eq(users.email, 'reuse@example.com') });
    const token = generateSecureToken();
    await db.insert(emailVerificationTokens).values({ userId: user!.id, tokenHash: token.hash, expiresAt: new Date(Date.now() + 1000 * 60) });

    await verifyEmail(db, token.raw);
    await expect(verifyEmail(db, token.raw)).rejects.toThrow(InvalidTokenError);
  });

  it('should log a user in with correct credentials and issue an access+refresh token pair', async () => {
    await signup(db, { email: 'login@example.com', password: 'correct-horse-1', workspaceName: 'A' });
    const result = await login(db, { email: 'login@example.com', password: 'correct-horse-1' });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.user.email).toBe('login@example.com');
  });

  it('should reject login when the password is wrong, with a generic error', async () => {
    await signup(db, { email: 'wrongpw@example.com', password: 'correct-horse-1', workspaceName: 'A' });
    await expect(login(db, { email: 'wrongpw@example.com', password: 'nope' })).rejects.toThrow(InvalidCredentialsError);
  });

  it('should reject login for an unknown email with the same generic error as a wrong password', async () => {
    await expect(login(db, { email: 'nobody@example.com', password: 'whatever1' })).rejects.toThrow(InvalidCredentialsError);
  });
});
