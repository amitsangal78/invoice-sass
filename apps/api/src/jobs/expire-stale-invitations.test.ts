import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, workspaceInvitations } from '@invoice-saas/db';
import { expireStaleInvitations } from './expire-stale-invitations';
import { createTestWorkspace } from '../test/fixtures';
import { createInvitation } from '../services/invitations/invitations';

describe('expireStaleInvitations', () => {
  it('should flip a past-due PENDING invitation to EXPIRED', async () => {
    const ws = await createTestWorkspace('expiretest1@example.com');
    const invitation = await createInvitation(db, ws.workspaceId, 'stale@example.com', 'MEMBER', ws.userId);
    await db.update(workspaceInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(workspaceInvitations.id, invitation!.id));

    const count = await expireStaleInvitations();
    expect(count).toBeGreaterThanOrEqual(1);

    const [updated] = await db.select().from(workspaceInvitations).where(eq(workspaceInvitations.id, invitation!.id));
    expect(updated!.status).toBe('EXPIRED');
  });

  it('should not touch a PENDING invitation that has not expired yet', async () => {
    const ws = await createTestWorkspace('expiretest2@example.com');
    const invitation = await createInvitation(db, ws.workspaceId, 'fresh@example.com', 'MEMBER', ws.userId);

    await expireStaleInvitations();

    const [updated] = await db.select().from(workspaceInvitations).where(eq(workspaceInvitations.id, invitation!.id));
    expect(updated!.status).toBe('PENDING');
  });

  it('should not touch an already-ACCEPTED invitation even if past its original expiry', async () => {
    const ws = await createTestWorkspace('expiretest3@example.com');
    const invitation = await createInvitation(db, ws.workspaceId, 'accepted@example.com', 'MEMBER', ws.userId);
    await db.update(workspaceInvitations).set({ expiresAt: new Date(Date.now() - 1000), status: 'ACCEPTED' }).where(eq(workspaceInvitations.id, invitation!.id));

    await expireStaleInvitations();

    const [updated] = await db.select().from(workspaceInvitations).where(eq(workspaceInvitations.id, invitation!.id));
    expect(updated!.status).toBe('ACCEPTED');
  });
});
