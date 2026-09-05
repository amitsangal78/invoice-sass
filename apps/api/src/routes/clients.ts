import { Router, type Router as RouterType } from 'express';
import { createClientSchema, updateClientSchema } from '@invoice-saas/types';
import { authenticate } from '../middleware/authenticate';
import { resolveWorkspace } from '../middleware/resolve-workspace';
import { requireRole } from '../middleware/require-role';
import { validateBody } from '../middleware/validate';
import { requireParam } from '../lib/params';
import { createClient, listClients, updateClient, archiveClient } from '../services/clients/clients';

export const clientsRouter: RouterType = Router();

clientsRouter.use(authenticate, resolveWorkspace);

clientsRouter.post('/', requireRole('ADMIN', 'MEMBER'), validateBody(createClientSchema), async (req, res, next) => {
  try {
    const client = await createClient(req.membership!.workspaceId, req.body);
    res.status(201).json({ data: client });
  } catch (err) {
    next(err);
  }
});

clientsRouter.get('/', requireRole('ADMIN', 'MEMBER'), async (req, res, next) => {
  try {
    const includeArchived = req.query.includeArchived === 'true';
    const clients = await listClients(req.membership!.workspaceId, includeArchived);
    res.json({ data: clients });
  } catch (err) {
    next(err);
  }
});

clientsRouter.patch('/:id', requireRole('ADMIN', 'MEMBER'), validateBody(updateClientSchema), async (req, res, next) => {
  try {
    const client = await updateClient(req.membership!.workspaceId, requireParam(req, 'id'), req.body);
    res.json({ data: client });
  } catch (err) {
    next(err);
  }
});

// "Delete" is always an archive, never a real delete (core-invoicing/design.md).
clientsRouter.delete('/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    await archiveClient(req.membership!.workspaceId, requireParam(req, 'id'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
