import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, workspaceInvitations, workspaceMembers } from '@invoice-saas/db';
import { signup } from '../auth/signup';
import { createInvitation, acceptInvitation, revokeInvitation } from './invitations';
import { generateSecureToken } from '../../lib/auth/tokens';
import { ApiHttpError, InvalidTokenError } from '../../lib/errors';

async function getRawTokenFor(invitationId: string): Promise<string> {
  // Test-only shortcut: createInvitation() only persists the hash (by design —
  // the raw token only ever leaves via email), so for tests we regenerate the
  // invitation with a token this test controls instead of parsing outbound email.
  const token = generateSecureToken();
  await db.update(workspaceInvitations).set({ tokenHash: token.hash }).where(eq(workspaceInvitations.id, invitationId));
  return token.raw;
}

describe('invitation acceptance', () => {
  it('should create a new user when accepting an invitation for an email with no existing account', async () => {
    const { workspaceId, userId: adminId } = await signup(db, { email: 'admin@ws1.example.com', password: 'correct-horse-1', workspaceName: 'WS1' });
    const invitation = await createInvitation(db, workspaceId, 'newperson@example.com', 'MEMBER', adminId);
    const rawToken = await getRawTokenFor(invitation!.id);

    const result = await acceptInvitation(db, rawToken, 'a-new-password-1');

    expect(result.workspaceId).toBe(workspaceId);
    const membership = await db.query.workspaceMembers.findFirst({ where: eq(workspaceMembers.userId, result.userId) });
    expect(membership?.role).toBe('MEMBER');
  });

  it('should reject a new-account acceptance with no password provided', async () => {
    const { workspaceId, userId: adminId } = await signup(db, { email: 'admin@ws2.example.com', password: 'correct-horse-1', workspaceName: 'WS2' });
    const invitation = await createInvitation(db, workspaceId, 'nopassword@example.com', 'MEMBER', adminId);
    const rawToken = await getRawTokenFor(invitation!.id);

    await expect(acceptInvitation(db, rawToken, undefined)).rejects.toThrow(ApiHttpError);
  });

  it('should link an existing account when the invited email already has one', async () => {
    // This person already has an account (owner of their own workspace).
    await signup(db, { email: 'existing@example.com', password: 'their-own-password-1', workspaceName: 'Their Own WS' });

    const { workspaceId, userId: adminId } = await signup(db, { email: 'admin@ws3.example.com', password: 'correct-horse-1', workspaceName: 'WS3' });
    const invitation = await createInvitation(db, workspaceId, 'existing@example.com', 'ADMIN', adminId);
    const rawToken = await getRawTokenFor(invitation!.id);

    // No password needed — this is the "link existing account" branch.
    const result = await acceptInvitation(db, rawToken, undefined);

    const memberships = await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, result.userId));
    // Now a member of both their original workspace AND the new one.
    expect(memberships).toHaveLength(2);
  });

  it('should reject acceptance of an already-accepted invitation', async () => {
    const { workspaceId, userId: adminId } = await signup(db, { email: 'admin@ws4.example.com', password: 'correct-horse-1', workspaceName: 'WS4' });
    const invitation = await createInvitation(db, workspaceId, 'onceonly@example.com', 'MEMBER', adminId);
    const rawToken = await getRawTokenFor(invitation!.id);

    await acceptInvitation(db, rawToken, 'a-new-password-1');
    await expect(acceptInvitation(db, rawToken, 'a-new-password-1')).rejects.toThrow(InvalidTokenError);
  });

  it('should reject acceptance of a revoked invitation', async () => {
    const { workspaceId, userId: adminId } = await signup(db, { email: 'admin@ws5.example.com', password: 'correct-horse-1', workspaceName: 'WS5' });
    const invitation = await createInvitation(db, workspaceId, 'revoked@example.com', 'MEMBER', adminId);
    const rawToken = await getRawTokenFor(invitation!.id);

    await revokeInvitation(db, invitation!.id);
    await expect(acceptInvitation(db, rawToken, 'a-new-password-1')).rejects.toThrow(InvalidTokenError);
  });
});
