import { and, eq } from 'drizzle-orm';
import { type Database, workspaces, workspaceMembers, ownershipTransfers } from '@invoice-saas/db';
import { generateSecureToken, hashToken } from '../../lib/auth/tokens';
import { sendEmail } from '../../lib/email';
import { writeAuditEvent } from '../../lib/audit';
import { ApiHttpError, InvalidTokenError } from '../../lib/errors';

const TRANSFER_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export async function initiateOwnershipTransfer(db: Database, workspaceId: string, fromUserId: string, toUserId: string): Promise<void> {
  const [targetMembership] = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, toUserId)));

  if (!targetMembership || targetMembership.role !== 'ADMIN') {
    throw new ApiHttpError(400, 'invalid_transfer_target', 'Ownership can only transfer to an existing ADMIN of this workspace.');
  }

  const token = generateSecureToken();
  await db.insert(ownershipTransfers).values({
    workspaceId,
    fromUserId,
    toUserId,
    tokenHash: token.hash,
    expiresAt: new Date(Date.now() + TRANSFER_TTL_MS),
  });

  await sendEmail(
    '(new owner)',
    'Confirm workspace ownership transfer',
    `Confirm: /workspaces/${workspaceId}/transfer-ownership/confirm?token=${token.raw}`,
  );
}

export async function confirmOwnershipTransfer(db: Database, rawToken: string, confirmingUserId: string): Promise<void> {
  const hash = hashToken(rawToken);
  const record = await db.query.ownershipTransfers.findFirst({ where: eq(ownershipTransfers.tokenHash, hash) });

  if (!record || record.confirmedAt || record.expiresAt.getTime() < Date.now()) {
    throw new InvalidTokenError('ownership transfer');
  }
  if (record.toUserId !== confirmingUserId) {
    throw new ApiHttpError(403, 'wrong_confirming_user', 'Only the proposed new owner can confirm this transfer.');
  }

  await db.transaction(async (tx) => {
    await tx.update(workspaces).set({ ownerId: record.toUserId }).where(eq(workspaces.id, record.workspaceId));
    await tx.update(ownershipTransfers).set({ confirmedAt: new Date() }).where(eq(ownershipTransfers.id, record.id));
  });

  await writeAuditEvent(db, {
    event: 'WORKSPACE_UPDATED',
    workspaceId: record.workspaceId,
    userId: confirmingUserId,
    oldValue: { ownerId: record.fromUserId },
    newValue: { ownerId: record.toUserId },
  });
}
