import type { Context, MiddlewareHandler } from 'hono';
import { HttpError } from '../errors.ts';
import { bindingsFor, clientKey, type RateLimiter, type RateLimitBinding } from '../../services/rate-limit.ts';

export type RateLimiterResolver = (c: Context, binding: RateLimitBinding) => RateLimiter | undefined;

// Runs before the route, so a limited request never reaches the database. A binding that is
// absent is skipped; a binding that throws is an error and surfaces as a 500 rather than
// silently disabling the limit.
export function rateLimitMiddleware(resolve: RateLimiterResolver): MiddlewareHandler {
  return async (c, next) => {
    const bindings = bindingsFor(c.req.method, c.req.path);
    if (bindings.length === 0) return next();

    const key = clientKey(c.req.raw.headers);
    for (const binding of bindings) {
      const limiter = resolve(c, binding);
      if (!limiter) continue;
      const { success } = await limiter.limit(key);
      if (!success) {
        throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many requests. Try again later.');
      }
    }
    return next();
  };
}
