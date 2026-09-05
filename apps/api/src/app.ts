import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { authRouter } from './routes/auth';
import { workspacesRouter } from './routes/workspaces';
import { invitationsRouter } from './routes/invitations';
import { adminRouter } from './routes/admin';
import { clientsRouter } from './routes/clients';
import { invoicesRouter } from './routes/invoices';
import { webhooksRouter } from './routes/webhooks';
import { eventsRouter } from './routes/events';
import { dashboardRouter } from './routes/dashboard';
import { errorHandler } from './middleware/error-handler';

// Versioned under /api/v1 from the start — three independent clients (web,
// admin, mobile) depend on it immediately (steering/requirements.md).
export function createApp(): Express {
  const app = express();

  app.use(pinoHttp({ redact: ['req.headers.authorization', 'req.headers.cookie'] }));
  app.use(cors());
  app.use(cookieParser());

  app.get('/health', (_req, res) => res.status(200).json({ data: { status: 'ok' } }));

  // Webhooks need the RAW body for signature verification — mounted before
  // express.json() so the body arrives as a Buffer, not pre-parsed JSON.
  app.use('/api/v1/webhooks', express.raw({ type: 'application/json' }), webhooksRouter);

  app.use(express.json());

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/workspaces', workspacesRouter);
  app.use('/api/v1/invitations', invitationsRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/clients', clientsRouter);
  app.use('/api/v1/invoices', invoicesRouter);
  app.use('/api/v1/events', eventsRouter);
  app.use('/api/v1/dashboard', dashboardRouter);

  // Must be registered last.
  app.use(errorHandler);

  return app;
}
