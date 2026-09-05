import type { Request } from 'express';
import { ApiHttpError } from './errors';

/**
 * Express 5's types allow a route param to be `string[]` (repeated-segment
 * routes like `/:id+`) even though none of our routes use that syntax — so
 * `req.params.foo` is typed `string | string[] | undefined`. This validates
 * it's actually the plain string every route here expects, rather than
 * silently casting the array case away.
 */
export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string') {
    throw new ApiHttpError(400, 'invalid_param', `Missing or invalid path parameter: ${name}`);
  }
  return value;
}
