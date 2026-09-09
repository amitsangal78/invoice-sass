import { Router, type Router as RouterType } from 'express';
import { createInvoiceSchema, updateInvoiceSchema, recordManualPaymentSchema } from '@invoice-saas/types';
import { authenticate } from '../middleware/authenticate';
import { resolveWorkspace } from '../middleware/resolve-workspace';
import { requireRole } from '../middleware/require-role';
import { validateBody } from '../middleware/validate';
import { requireParam } from '../lib/params';
import {
  createInvoice,
  getInvoice,
  listInvoices,
  updateInvoice,
  deleteInvoice,
  sendInvoice,
  recordManualPayment,
  cancelInvoice,
  getInvoicePdf,
} from '../services/invoicing/invoices';

export const invoicesRouter: RouterType = Router();

invoicesRouter.use(authenticate, resolveWorkspace);

invoicesRouter.post('/', requireRole('ADMIN', 'MEMBER'), validateBody(createInvoiceSchema), async (req, res, next) => {
  try {
    const invoice = await createInvoice(req.membership!.workspaceId, req.body);
    res.status(201).json({ data: invoice });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.get('/', requireRole('ADMIN', 'MEMBER'), async (req, res, next) => {
  try {
    res.json({ data: await listInvoices(req.membership!.workspaceId) });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.get('/:id', requireRole('ADMIN', 'MEMBER'), async (req, res, next) => {
  try {
    res.json({ data: await getInvoice(req.membership!.workspaceId, requireParam(req, 'id')) });
  } catch (err) {
    next(err);
  }
});

// Binary response — the one deliberate exception to the `{ data }` JSON
// envelope (a PDF can't be wrapped in JSON), see rules/backend-api.md.
invoicesRouter.get('/:id/pdf', requireRole('ADMIN', 'MEMBER'), async (req, res, next) => {
  try {
    const pdf = await getInvoicePdf(req.membership!.workspaceId, requireParam(req, 'id'));
    res.type('application/pdf').send(pdf);
  } catch (err) {
    next(err);
  }
});

invoicesRouter.patch('/:id', requireRole('ADMIN', 'MEMBER'), validateBody(updateInvoiceSchema), async (req, res, next) => {
  try {
    res.json({ data: await updateInvoice(req.membership!.workspaceId, requireParam(req, 'id'), req.body) });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await deleteInvoice(req.membership!.workspaceId, requireParam(req, 'id'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

invoicesRouter.post('/:id/send', requireRole('ADMIN', 'MEMBER'), async (req, res, next) => {
  try {
    res.json({ data: await sendInvoice(req.membership!.workspaceId, requireParam(req, 'id')) });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.post('/:id/mark-paid', requireRole('ADMIN', 'MEMBER'), validateBody(recordManualPaymentSchema), async (req, res, next) => {
  try {
    const status = await recordManualPayment(req.membership!.workspaceId, requireParam(req, 'id'), req.body.amount, req.user!.id);
    res.json({ data: { status } });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.post('/:id/cancel', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await cancelInvoice(req.membership!.workspaceId, requireParam(req, 'id'), req.user!.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
