import { and, eq } from 'drizzle-orm';
import { type Database, workspaces, workspaceMembers, type WorkspaceRole } from '@invoice-saas/db';
import { invalidateCache } from '../../lib/redis';
import { writeAuditEvent } from '../../lib/audit';
import { ApiHttpError } from '../../lib/errors';
import { logoutAll } from '../auth/logout';

async function assertNotOwner(db: Database, workspaceId: string, targetUserId: string): Promise<void> {
  const [workspace] = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, workspaceId));
  if (workspace?.ownerId === targetUserId) {
    // Ownership isn't a side effect of a role change/removal — see identity-and-rbac/design.md story 2.
    throw new ApiHttpError(409, 'cannot_modify_owner', 'The workspace owner cannot be role-changed or removed this way — use ownership transfer.');
  }
}

export async function listMembers(db: Database, workspaceId: string) {
  return db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
}

export async function changeRole(db: Database, workspaceId: string, targetUserId: string, role: WorkspaceRole, actingUserId: string): Promise<void> {
  await assertNotOwner(db, workspaceId, targetUserId);

  const [before] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));

  await db
    .update(workspaceMembers)
    .set({ role })
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));

  await invalidateCache(`workspace:${workspaceId}:permissions:${targetUserId}`);
  await writeAuditEvent(db, {
    event: 'ROLE_CHANGED',
    workspaceId,
    userId: actingUserId,
    oldValue: before,
    newValue: { role },
  });
}

export async function removeMember(db: Database, workspaceId: string, targetUserId: string, actingUserId: string): Promise<void> {
  await assertNotOwner(db, workspaceId, targetUserId);

  await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, targetUserId)));

  await invalidateCache(`workspace:${workspaceId}:permissions:${targetUserId}`);
  // Defense in depth per identity-and-rbac/design.md — workspace-resolution
  // failure alone is sufficient for correctness, this just closes existing sessions too.
  await logoutAll(db, targetUserId);
  await writeAuditEvent(db, { event: 'WORKSPACE_UPDATED', workspaceId, userId: actingUserId, newValue: { removedUserId: targetUserId } });
}
