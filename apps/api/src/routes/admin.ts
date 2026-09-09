import { Router, type Router as RouterType } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requirePlatformRole } from '../middleware/require-role';
import { requireParam } from '../lib/params';
import { withAdminAuditLog } from '../lib/audit';
import { listAllWorkspaces, getWorkspaceDetail, suspendWorkspace, reactivateWorkspace } from '../services/admin/manage-workspaces';
import { db } from '@invoice-saas/db';

export const adminRouter: RouterType = Router();

adminRouter.use(authenticate, requirePlatformRole('SUPER_ADMIN', 'SUPPORT_ADMIN'));

adminRouter.get('/workspaces', async (_req, res, next) => {
  try {
    res.json({ data: await listAllWorkspaces() });
  } catch (err) {
    next(err);
  }
});

// Viewing one tenant's detail (plan, member count) is support-only,
// exceptional access — audited on every view (identity-and-rbac/design.md's
// admin-audit-on-view), not routine like the list endpoint above.
adminRouter.get('/workspaces/:id', async (req, res, next) => {
  try {
    const workspaceId = requireParam(req, 'id');
    const detail = await withAdminAuditLog(db, { workspaceId, userId: req.user!.id, detail: 'workspace detail view' }, () => getWorkspaceDetail(workspaceId));
    res.json({ data: detail });
  } catch (err) {
    next(err);
  }
});

// SUPER_ADMIN only — a SUPPORT_ADMIN can view tenant status but not act on it
// (identity-and-rbac/design.md's RBAC table).
adminRouter.post('/workspaces/:id/suspend', requirePlatformRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    await suspendWorkspace(requireParam(req, 'id'), req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/workspaces/:id/reactivate', requirePlatformRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    await reactivateWorkspace(requireParam(req, 'id'), req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
