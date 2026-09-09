import { and, eq, lt } from 'drizzle-orm';
import { db, workspaceInvitations } from '@invoice-saas/db';

/**
 * Daily job — flips unaccepted, past-expiry PENDING invitations to EXPIRED.
 * `acceptInvitation()` already rejects expired invitations by comparing
 * `expiresAt` directly, so this job is data hygiene (a workspace's
 * invitation list reads correctly without anyone opening it), not a
 * security boundary in itself (identity-and-rbac/tasks.md's flagged gap).
 */
export async function expireStaleInvitations(): Promise<number> {
  const result = await db
    .update(workspaceInvitations)
    .set({ status: 'EXPIRED' })
    .where(and(eq(workspaceInvitations.status, 'PENDING'), lt(workspaceInvitations.expiresAt, new Date())))
    .returning({ id: workspaceInvitations.id });

  return result.length;
}
