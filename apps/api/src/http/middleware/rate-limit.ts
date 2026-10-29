import type { Context, MiddlewareHandler } from 'hono';
import { HttpError } from '../errors.ts';
import { bindingsFor, clientKey, UNKNOWN_CLIENT_KEY, type RateLimiter, type RateLimitBinding } from '../../services/rate-limit.ts';

export type RateLimiterResolver = (c: Context, binding: RateLimitBinding) => RateLimiter | undefined;

export interface RateLimitOptions {
  // true on the deployed Worker: a missing binding is a deployment fault, so it is logged loudly
  // on every request that needs it. Node and tests leave this false and skip absent bindings.
  bindingsRequired?: boolean;
}

// Structured log lines carry the binding name and event only: never a client IP, token or secret.
function logEvent(level: 'error' | 'warn', event: string, binding: RateLimitBinding, errorName?: string): void {
  const line = JSON.stringify({ level, event, binding, ...(errorName ? { errorClass: errorName } : {}) });
  if (level === 'error') console.error(line);
  else console.warn(line);
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// Runs before the route and before authentication, so a limited request never reaches the
// database and unauthenticated bursts are counted too. The limiter is a soft control: when it
// throws, the request is let through and rate_limit_error is logged.
export function rateLimitMiddleware(resolve: RateLimiterResolver, options: RateLimitOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const bindings = bindingsFor(c.req.method, c.req.path);
    if (bindings.length === 0) return next();

    const key = clientKey(c.req.raw.headers);
    // Every client sharing the fallback bucket is a deployment fault; log it without the value.
    if (key === UNKNOWN_CLIENT_KEY && options.bindingsRequired) {
      console.warn(JSON.stringify({ level: 'warn', event: 'rate_limit_client_ip_missing' }));
    }
    for (const binding of bindings) {
      const limiter = resolve(c, binding);
      if (!limiter) {
        if (options.bindingsRequired) logEvent('error', 'rate_limit_binding_absent', binding);
        continue;
      }
      // Fail open: a Cloudflare-side fault must not take the API down. Only the error class is
      // logged, never the message, which could echo the key.
      let success: boolean;
      try {
        ({ success } = await limiter.limit(key));
      } catch (error) {
        logEvent('error', 'rate_limit_error', binding, errorClass(error));
        continue;
      }
      if (!success) {
        logEvent('warn', 'rate_limit_refused', binding);
        throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many requests. Try again later.');
      }
    }
    return next();
  };
}
