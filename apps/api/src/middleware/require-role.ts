import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, workspaces, type PlatformRole, type WorkspaceRole } from '@invoice-saas/db';
import { InsufficientRoleError, OwnerOnlyError, NotAMemberError } from '../lib/errors';

export function requireRole(...roles: WorkspaceRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.membership || !roles.includes(req.membership.role)) {
      next(new InsufficientRoleError(roles));
      return;
    }
    next();
  };
}

/** Owner-only actions (delete workspace, cancel subscription, change billing) —
 * separate from requireRole('ADMIN'): being ADMIN is necessary but not
 * sufficient (identity-and-rbac/design.md). */
export async function requireOwner(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.membership || !req.user) {
      next(new NotAMemberError());
      return;
    }
    const [workspace] = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, req.membership.workspaceId));
    if (!workspace || workspace.ownerId !== req.user.id) {
      next(new OwnerOnlyError());
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** For admin-console routes — checks the platform role, no workspace involved. */
export function requirePlatformRole(...roles: PlatformRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.platformRole)) {
      next(new InsufficientRoleError(roles));
      return;
    }
    next();
  };
}
