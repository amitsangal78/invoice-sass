import { eq } from 'drizzle-orm';
import { db, workspaces, subscriptions, workspaceMembers } from '@invoice-saas/db';
import { writeAuditEvent } from '../../lib/audit';
import { invalidateCachePattern } from '../../lib/redis';
import { ApiHttpError } from '../../lib/errors';

/**
 * Cross-tenant reads/writes live here, in their own explicitly-named
 * service — never inline in a route that "forgot" the normal workspace
 * scoping (rules/backend-api.md's rule for admin-only cross-tenant access).
 */

export async function listAllWorkspaces() {
  return db.select({ id: workspaces.id, name: workspaces.name, isSuspended: workspaces.isSuspended, createdAt: workspaces.createdAt }).from(workspaces);
}

export interface WorkspaceDetail {
  id: string;
  name: string;
  isSuspended: boolean;
  ownerId: string;
  plan: string;
  subscriptionStatus: string;
  memberCount: number;
}

export async function getWorkspaceDetail(workspaceId: string): Promise<WorkspaceDetail> {
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!workspace) throw new ApiHttpError(404, 'workspace_not_found', 'Workspace not found.');

  const [sub] = await db.select({ plan: subscriptions.plan, status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
  const members = await db.select({ id: workspaceMembers.id }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));

  return {
    id: workspace.id,
    name: workspace.name,
    isSuspended: workspace.isSuspended,
    ownerId: workspace.ownerId,
    plan: sub?.plan ?? 'FREE',
    subscriptionStatus: sub?.status ?? 'ACTIVE',
    memberCount: members.length,
  };
}

async function setSuspended(workspaceId: string, isSuspended: boolean, actingUserId: string): Promise<void> {
  const [updated] = await db.update(workspaces).set({ isSuspended }).where(eq(workspaces.id, workspaceId)).returning();
  if (!updated) throw new ApiHttpError(404, 'workspace_not_found', 'Workspace not found.');

  // Every member's cached permissions entry embeds isSuspended
  // (middleware/resolve-workspace.ts) — invalidate all of them for this
  // workspace so the suspension takes effect immediately on every member's
  // next request, not just after the cache TTL expires.
  await invalidateCachePattern(`workspace:${workspaceId}:permissions:*`);

  await writeAuditEvent(db, {
    event: 'WORKSPACE_UPDATED',
    workspaceId,
    userId: actingUserId,
    newValue: { isSuspended },
  });
}

export async function suspendWorkspace(workspaceId: string, actingUserId: string): Promise<void> {
  await setSuspended(workspaceId, true, actingUserId);
}

export async function reactivateWorkspace(workspaceId: string, actingUserId: string): Promise<void> {
  await setSuspended(workspaceId, false, actingUserId);
}
