import { Router, type Router as RouterType } from 'express';
import { db, workspaces } from '@invoice-saas/db';
import { authenticate } from '../middleware/authenticate';
import { requirePlatformRole } from '../middleware/require-role';

export const adminRouter: RouterType = Router();

adminRouter.use(authenticate, requirePlatformRole('SUPER_ADMIN', 'SUPPORT_ADMIN'));

// Minimal example proving requirePlatformRole end-to-end — the admin console's
// full feature set (tenant search UI, plan override, webhook inspection) is
// its own future spec; this exists to validate the authorization model only
// (identity-and-rbac/requirements.md's explicit exclusion).
adminRouter.get('/workspaces', async (_req, res, next) => {
  try {
    const rows = await db.select({ id: workspaces.id, name: workspaces.name, isSuspended: workspaces.isSuspended }).from(workspaces);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});
