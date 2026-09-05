import type { NextFunction, Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db, workspaceMembers, workspaces } from '@invoice-saas/db';
import { cacheAside } from '../lib/redis';
import { NotAMemberError, WorkspaceSuspendedError } from '../lib/errors';

const PERMISSIONS_CACHE_TTL_SECONDS = 600; // 10 min — within the 5-15 min range in tech.md

interface CachedMembership {
  role: 'ADMIN' | 'MEMBER';
  isSuspended: boolean;
}

function extractWorkspaceId(req: Request): string | undefined {
  const fromParams = req.params.workspaceId ?? req.params.id;
  if (typeof fromParams === 'string') return fromParams;
  const header = req.headers['x-workspace-id'];
  return typeof header === 'string' ? header : undefined;
}

/**
 * Resolves the caller's membership for the workspace named in the route/header.
 * The workspace id is a LOOKUP KEY only — this middleware, not its mere
 * presence, is what authorizes (identity-and-rbac/design.md story 5).
 */
export async function resolveWorkspace(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const workspaceId = extractWorkspaceId(req);
    if (!workspaceId || !req.user) {
      next(new NotAMemberError());
      return;
    }

    const cacheKey = `workspace:${workspaceId}:permissions:${req.user.id}`;
    const cached = await cacheAside<CachedMembership | null>(cacheKey, PERMISSIONS_CACHE_TTL_SECONDS, async () => {
      const [membership] = await db
        .select({ role: workspaceMembers.role, isSuspended: workspaces.isSuspended })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(and(eq(workspaceMembers.userId, req.user!.id), eq(workspaceMembers.workspaceId, workspaceId)));
      return membership ?? null;
    });

    if (!cached) {
      next(new NotAMemberError());
      return;
    }
    if (cached.isSuspended) {
      next(new WorkspaceSuspendedError());
      return;
    }

    req.membership = { workspaceId, role: cached.role };
    next();
  } catch (err) {
    next(err);
  }
}
