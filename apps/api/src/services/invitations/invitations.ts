import { eq } from 'drizzle-orm';
import {
  type Database,
  users,
  workspaceMembers,
  workspaceInvitations,
  type WorkspaceRole,
} from '@invoice-saas/db';
import { generateSecureToken, hashToken } from '../../lib/auth/tokens';
import { hashPassword } from '../../lib/auth/password';
import { sendEmail } from '../../lib/email';
import { writeAuditEvent } from '../../lib/audit';
import { ApiHttpError, InvalidTokenError } from '../../lib/errors';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — identity-and-rbac/design.md

export async function createInvitation(db: Database, workspaceId: string, email: string, role: WorkspaceRole, invitedBy: string) {
  const token = generateSecureToken();
  const [invitation] = await db
    .insert(workspaceInvitations)
    .values({
      workspaceId,
      email,
      role,
      tokenHash: token.hash,
      invitedBy,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    })
    .returning();

  await sendEmail(email, "You've been invited to a Billify workspace", `Accept: /invitations/${token.raw}/accept`);
  await writeAuditEvent(db, { event: 'MEMBER_INVITED', workspaceId, userId: invitedBy, newValue: { email, role } });

  return invitation;
}

export async function resendInvitation(db: Database, invitationId: string) {
  const token = generateSecureToken();
  const [invitation] = await db
    .update(workspaceInvitations)
    .set({ tokenHash: token.hash, expiresAt: new Date(Date.now() + INVITATION_TTL_MS) })
    .where(eq(workspaceInvitations.id, invitationId))
    .returning();

  if (!invitation) throw new ApiHttpError(404, 'invitation_not_found', 'Invitation not found.');
  await sendEmail(invitation.email, "You've been invited to a Billify workspace", `Accept: /invitations/${token.raw}/accept`);
  return invitation;
}

export async function revokeInvitation(db: Database, invitationId: string): Promise<void> {
  await db.update(workspaceInvitations).set({ status: 'REVOKED' }).where(eq(workspaceInvitations.id, invitationId));
}

export interface AcceptInvitationResult {
  userId: string;
  workspaceId: string;
}

/**
 * Two branches: link an existing account (this email already has a
 * `users` row, e.g. a member of a different workspace) or create a new one.
 * Either way the invitation must be PENDING and unexpired.
 */
export async function acceptInvitation(db: Database, rawToken: string, password: string | undefined): Promise<AcceptInvitationResult> {
  const hash = hashToken(rawToken);
  const invitation = await db.query.workspaceInvitations.findFirst({ where: eq(workspaceInvitations.tokenHash, hash) });

  if (!invitation || invitation.status !== 'PENDING' || invitation.expiresAt.getTime() < Date.now()) {
    throw new InvalidTokenError('invitation');
  }

  return db.transaction(async (tx) => {
    let user = await tx.query.users.findFirst({ where: eq(users.email, invitation.email) });

    if (!user) {
      if (!password) {
        throw new ApiHttpError(400, 'password_required', 'A password is required to accept this invitation.');
      }
      const passwordHash = await hashPassword(password);
      // Invitation acceptance via a working email link IS the verification.
      const [created] = await tx
        .insert(users)
        .values({ email: invitation.email, passwordHash, platformRole: 'NORMAL_USER', isVerified: true })
        .returning();
      user = created;
    }
    if (!user) throw new Error('User resolution failed during invitation acceptance');

    await tx.insert(workspaceMembers).values({ userId: user.id, workspaceId: invitation.workspaceId, role: invitation.role });
    await tx.update(workspaceInvitations).set({ status: 'ACCEPTED' }).where(eq(workspaceInvitations.id, invitation.id));

    return { userId: user.id, workspaceId: invitation.workspaceId };
  });
}
