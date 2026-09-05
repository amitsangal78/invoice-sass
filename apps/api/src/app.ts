import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { authRouter } from './routes/auth';
import { workspacesRouter } from './routes/workspaces';
import { invitationsRouter } from './routes/invitations';
import { adminRouter } from './routes/admin';
import { errorHandler } from './middleware/error-handler';

// Versioned under /api/v1 from the start — three independent clients (web,
// admin, mobile) depend on it immediately (steering/requirements.md).
export function createApp(): Express {
  const app = express();

  app.use(pinoHttp({ redact: ['req.headers.authorization', 'req.headers.cookie'] }));
  app.use(cors());
  app.use(cookieParser());
  app.use(express.json());

  app.get('/health', (_req, res) => res.status(200).json({ data: { status: 'ok' } }));

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/workspaces', workspacesRouter);
  app.use('/api/v1/invitations', invitationsRouter);
  app.use('/api/v1/admin', adminRouter);

  // Must be registered last.
  app.use(errorHandler);

  return app;
}
