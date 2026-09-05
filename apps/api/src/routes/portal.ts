import { Router, type Router as RouterType } from 'express';
import { updatePortalProfileSchema } from '@invoice-saas/types';
import { authenticatePortalSession } from '../middleware/portal/authenticate-portal-session';
import { resolveClientContext } from '../middleware/portal/resolve-client-context';
import { validateBody } from '../middleware/validate';
import { requireParam } from '../lib/params';
import { listPortalBusinesses } from '../services/portal-auth/portal-auth';
import { listInvoicesForClient, getInvoiceForClient, listPaymentsForClient, initiatePortalPayment, updatePortalProfile } from '../services/portal-auth/portal-invoices';

export const portalRouter: RouterType = Router();

portalRouter.use(authenticatePortalSession);

portalRouter.get('/businesses', async (req, res, next) => {
  try {
    res.json({ data: await listPortalBusinesses(req.portalEmail!) });
  } catch (err) {
    next(err);
  }
});

portalRouter.get('/:clientId/invoices', resolveClientContext, async (req, res, next) => {
  try {
    res.json({ data: await listInvoicesForClient(req.portalClientId!) });
  } catch (err) {
    next(err);
  }
});

portalRouter.get('/:clientId/invoices/:invoiceId', resolveClientContext, async (req, res, next) => {
  try {
    res.json({ data: await getInvoiceForClient(req.portalClientId!, requireParam(req, 'invoiceId')) });
  } catch (err) {
    next(err);
  }
});

portalRouter.post('/:clientId/invoices/:invoiceId/pay', resolveClientContext, async (req, res, next) => {
  try {
    res.json({ data: await initiatePortalPayment(req.portalClientId!, requireParam(req, 'invoiceId')) });
  } catch (err) {
    next(err);
  }
});

portalRouter.get('/:clientId/payments', resolveClientContext, async (req, res, next) => {
  try {
    res.json({ data: await listPaymentsForClient(req.portalClientId!) });
  } catch (err) {
    next(err);
  }
});

portalRouter.patch('/:clientId/profile', resolveClientContext, validateBody(updatePortalProfileSchema), async (req, res, next) => {
  try {
    res.json({ data: await updatePortalProfile(req.portalClientId!, req.body) });
  } catch (err) {
    next(err);
  }
});
