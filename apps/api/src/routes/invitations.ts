import { Router, type Router as RouterType } from 'express';
import { db } from '@invoice-saas/db';
import { acceptInvitationSchema } from '@invoice-saas/types';
import { validateBody } from '../middleware/validate';
import { acceptInvitation } from '../services/invitations/invitations';
import { requireParam } from '../lib/params';

export const invitationsRouter: RouterType = Router();

// Public — accepting an invitation is how an account may first come into
// existence, so this can't require prior authentication.
invitationsRouter.post('/:token/accept', validateBody(acceptInvitationSchema), async (req, res, next) => {
  try {
    const result = await acceptInvitation(db, requireParam(req, 'token'), req.body.password);
    res.status(200).json({ data: result });
  } catch (err) {
    next(err);
  }
});
