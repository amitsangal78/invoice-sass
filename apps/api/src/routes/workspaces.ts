import { Router, type Router as RouterType } from 'express';
import { db } from '@invoice-saas/db';
import { changeRoleSchema, inviteMemberSchema, transferOwnershipSchema } from '@invoice-saas/types';
import { authenticate } from '../middleware/authenticate';
import { resolveWorkspace } from '../middleware/resolve-workspace';
import { requireRole, requireOwner } from '../middleware/require-role';
import { validateBody } from '../middleware/validate';
import { listMembers, changeRole, removeMember } from '../services/workspaces/members';
import { initiateOwnershipTransfer, confirmOwnershipTransfer } from '../services/workspaces/ownership';
import { createInvitation, resendInvitation, revokeInvitation } from '../services/invitations/invitations';
import { requireParam } from '../lib/params';

export const workspacesRouter: RouterType = Router();

workspacesRouter.use(authenticate);

workspacesRouter.get('/:id/members', resolveWorkspace, requireRole('ADMIN', 'MEMBER'), async (req, res, next) => {
  try {
    const members = await listMembers(db, req.membership!.workspaceId);
    res.json({ data: members });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.patch(
  '/:id/members/:userId',
  resolveWorkspace,
  requireRole('ADMIN'),
  validateBody(changeRoleSchema),
  async (req, res, next) => {
    try {
      await changeRole(db, req.membership!.workspaceId, requireParam(req, 'userId'), req.body.role, req.user!.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

workspacesRouter.delete('/:id/members/:userId', resolveWorkspace, requireRole('ADMIN'), async (req, res, next) => {
  try {
    await removeMember(db, req.membership!.workspaceId, requireParam(req, 'userId'), req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

workspacesRouter.post(
  '/:id/transfer-ownership',
  resolveWorkspace,
  requireOwner,
  validateBody(transferOwnershipSchema),
  async (req, res, next) => {
    try {
      await initiateOwnershipTransfer(db, req.membership!.workspaceId, req.user!.id, req.body.newOwnerUserId);
      res.status(202).send();
    } catch (err) {
      next(err);
    }
  },
);

// Confirmed by the NEW owner, not the current one — no resolveWorkspace/requireOwner
// here, since the confirming user isn't necessarily verified as a member yet by
// that path; the token itself (tied to a specific toUserId) is the authorization.
workspacesRouter.post('/:id/transfer-ownership/confirm', async (req, res, next) => {
  try {
    await confirmOwnershipTransfer(db, req.body.token, req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

workspacesRouter.post(
  '/:id/invitations',
  resolveWorkspace,
  requireRole('ADMIN'),
  validateBody(inviteMemberSchema),
  async (req, res, next) => {
    try {
      const invitation = await createInvitation(db, req.membership!.workspaceId, req.body.email, req.body.role, req.user!.id);
      res.status(201).json({ data: invitation });
    } catch (err) {
      next(err);
    }
  },
);

workspacesRouter.post('/:id/invitations/:invId/resend', resolveWorkspace, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const invitation = await resendInvitation(db, requireParam(req, 'invId'));
    res.json({ data: invitation });
  } catch (err) {
    next(err);
  }
});

workspacesRouter.delete('/:id/invitations/:invId', resolveWorkspace, requireRole('ADMIN'), async (req, res, next) => {
  try {
    await revokeInvitation(db, requireParam(req, 'invId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
