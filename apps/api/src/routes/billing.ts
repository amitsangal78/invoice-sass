import { Router, type Router as RouterType } from 'express';
import { authenticate } from '../middleware/authenticate';
import { resolveWorkspace } from '../middleware/resolve-workspace';
import { requireOwner, requireRole } from '../middleware/require-role';
import { initiateCheckout, cancelSubscription, getSubscription } from '../services/subscriptions/subscription-billing';

export const billingRouter: RouterType = Router();

billingRouter.use(authenticate, resolveWorkspace);

// Owner-only, not merely ADMIN — identity-and-rbac's requireOwner, matching
// this spec's resolved decision (requirements.md story 3 / acceptance criteria).
billingRouter.post('/checkout', requireOwner, async (req, res, next) => {
  try {
    const { plan } = req.body as { plan?: 'STARTER' | 'PRO' };
    if (plan !== 'STARTER' && plan !== 'PRO') {
      res.status(400).json({ error: { code: 'invalid_plan', message: 'plan must be STARTER or PRO.' } });
      return;
    }
    res.json({ data: await initiateCheckout(req.membership!.workspaceId, plan) });
  } catch (err) {
    next(err);
  }
});

billingRouter.post('/cancel', requireOwner, async (req, res, next) => {
  try {
    await cancelSubscription(req.membership!.workspaceId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// Read-only, any workspace member — this is the endpoint the mobile app
// calls per requirements.md story 4 (plan/renewal display, "Manage on web").
billingRouter.get('/plan', requireRole('ADMIN', 'MEMBER'), async (req, res, next) => {
  try {
    res.json({ data: await getSubscription(req.membership!.workspaceId) });
  } catch (err) {
    next(err);
  }
});
