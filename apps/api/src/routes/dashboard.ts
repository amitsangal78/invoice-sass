import { Router, type Router as RouterType } from 'express';
import { authenticate } from '../middleware/authenticate';
import { resolveWorkspace } from '../middleware/resolve-workspace';
import { requireRole } from '../middleware/require-role';
import { getDashboardSummary } from '../services/dashboard/summary';

export const dashboardRouter: RouterType = Router();

dashboardRouter.get('/summary', authenticate, resolveWorkspace, requireRole('ADMIN', 'MEMBER'), async (req, res, next) => {
  try {
    res.json({ data: await getDashboardSummary(req.membership!.workspaceId) });
  } catch (err) {
    next(err);
  }
});
