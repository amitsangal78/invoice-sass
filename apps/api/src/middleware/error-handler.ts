import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiHttpError } from '../lib/errors';

// One centralized error middleware, one response shape — no route invents its
// own error format (rules/backend-api.md). Must be registered last.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiHttpError) {
    res.status(err.httpStatus).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'validation_error', message: err.issues.map((i) => i.message).join('; ') } });
    return;
  }

  req.log?.error({ err }, 'Unhandled error');
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong.' } });
}
