import type { NextFunction, Request, Response } from 'express';
import { resolvePortalSession } from '../../services/portal-auth/portal-auth';
import { ApiHttpError } from '../../lib/errors';

/**
 * Entirely separate from the tenant `authenticate` middleware — a portal
 * session is a different principal type (`USER`/client, not a workspace
 * member) and must never be mixed with the tenant auth chain
 * (client-portal/design.md).
 */
export async function authenticatePortalSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      next(new ApiHttpError(401, 'unauthenticated', 'Missing portal session token.'));
      return;
    }

    const session = await resolvePortalSession(header.slice('Bearer '.length));
    if (!session) {
      next(new ApiHttpError(401, 'unauthenticated', 'Invalid or expired portal session.'));
      return;
    }

    req.portalEmail = session.email;
    next();
  } catch (err) {
    next(err);
  }
}
