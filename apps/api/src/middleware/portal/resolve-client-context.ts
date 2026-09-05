import type { NextFunction, Request, Response } from 'express';
import { and, eq } from 'drizzle-orm';
import { db, clientUsers } from '@invoice-saas/db';
import { requireParam } from '../../lib/params';
import { ApiHttpError } from '../../lib/errors';

/**
 * The isolation check from client-portal/requirements.md story 4 — re-verified
 * on EVERY request, never inferred from a previously-authorized session. A
 * valid portal session for one client id must not grant access to another,
 * even under the same authenticated email (defense in depth).
 */
export async function resolveClientContext(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const clientId = requireParam(req, 'clientId');
    if (!req.portalEmail) {
      next(new ApiHttpError(401, 'unauthenticated', 'Portal session required.'));
      return;
    }

    const [match] = await db
      .select({ clientId: clientUsers.clientId })
      .from(clientUsers)
      .where(and(eq(clientUsers.email, req.portalEmail), eq(clientUsers.clientId, clientId)));

    if (!match) {
      next(new ApiHttpError(403, 'not_your_business', 'This invoice/client record does not belong to your account.'));
      return;
    }

    req.portalClientId = clientId;
    next();
  } catch (err) {
    next(err);
  }
}
