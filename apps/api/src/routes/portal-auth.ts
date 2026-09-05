import { Router, type Router as RouterType } from 'express';
import { requestMagicLinkSchema, verifyMagicLinkSchema } from '@invoice-saas/types';
import { validateBody } from '../middleware/validate';
import { rateLimit } from '../middleware/rate-limit';
import { requestMagicLink, verifyMagicLink, logoutPortalSession } from '../services/portal-auth/portal-auth';

export const portalAuthRouter: RouterType = Router();

// 5 requests/hour per email+IP — same order of magnitude as identity-and-rbac's
// forgot-password limit, since this is also a "send me a login link" endpoint.
portalAuthRouter.post(
  '/request-link',
  rateLimit({ keyPrefix: 'portal-request-link', max: 5, windowSeconds: 60 * 60, keyFrom: (req) => `${req.ip}:${String(req.body?.email ?? 'unknown').toLowerCase()}` }),
  validateBody(requestMagicLinkSchema),
  async (req, res, next) => {
    try {
      await requestMagicLink(req.body.email);
      res.status(204).send(); // always 204 — no account enumeration
    } catch (err) {
      next(err);
    }
  },
);

portalAuthRouter.post('/verify', validateBody(verifyMagicLinkSchema), async (req, res, next) => {
  try {
    const result = await verifyMagicLink(req.body.token);
    res.json({ data: result });
  } catch (err) {
    next(err);
  }
});

portalAuthRouter.post('/logout', async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      await logoutPortalSession(header.slice('Bearer '.length));
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
