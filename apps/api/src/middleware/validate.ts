import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema } from 'zod';

/** Validates req.body against a zod schema from packages/types, replacing it
 * with the parsed (typed, defaulted) value. Errors flow to errorHandler. */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      next(err);
    }
  };
}
