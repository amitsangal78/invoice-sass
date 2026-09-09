import { eq, sql } from 'drizzle-orm';
import { db, workspaceMembers, workspaces } from '@invoice-saas/db';

/**
 * Filled gap: login() intentionally never embeds workspace/role in the JWT
 * (identity-and-rbac/design.md — authorization is resolved fresh per
 * request), but that means the frontend has no way to discover which
 * workspace(s) the user belongs to after logging in. Every other route
 * requires a workspace id already in hand. This is that missing first call.
 */
export async function listMyWorkspaces(userId: string) {
  return db
    .select({
      workspaceId: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
      isOwner: sql<boolean>`${workspaces.ownerId} = ${userId}`,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId));
}
