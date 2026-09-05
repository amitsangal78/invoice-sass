import { Router, type Router as RouterType } from 'express';
import { authenticate } from '../middleware/authenticate';
import { resolveWorkspace } from '../middleware/resolve-workspace';
import { requireRole } from '../middleware/require-role';
import { subscribeToWorkspaceEvents } from '../lib/sse';

export const eventsRouter: RouterType = Router();

// SSE doesn't get a security exemption — same auth/workspace/role chain as
// any other route (core-invoicing/design.md).
eventsRouter.get('/', authenticate, resolveWorkspace, requireRole('ADMIN', 'MEMBER'), (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  subscribeToWorkspaceEvents(req.membership!.workspaceId, res);
});
