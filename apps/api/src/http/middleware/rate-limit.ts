import type { Context, MiddlewareHandler } from 'hono';
import {
  clientKey,
  softBindingsFor,
  UNKNOWN_CLIENT_KEY,
  windowBucketsFor,
  WINDOW_BUCKETS,
  type RateLimiter,
  type RateLimitBinding,
  type WindowCounter,
} from '../../services/rate-limit.ts';
import { HttpError } from '../errors.ts';

export type RateLimiterResolver = (c: Context, binding: RateLimitBinding) => RateLimiter | undefined;
export type WindowCounterResolver = (c: Context) => WindowCounter | undefined;

export interface RateLimitOptions {
  // true on the deployed Worker: a missing binding or pool is a deployment fault, and a request
  // without a client address uses the shared fallback key (logged). Node and tests leave this
  // false: a request without a client address is not limited.
  bindingsRequired?: boolean;
}

// Structured log lines carry the binding or bucket name and the error class only: never a client
// IP, token, secret or error message (messages can echo the key).
function logLine(level: 'error' | 'warn', event: string, fields: Record<string, string>): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else console.warn(line);
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

// Soft, per-location limit on general writes (Cloudflare binding). Approximate; fail open: a
// throwing binding lets the request through and is logged.
export function rateLimitMiddleware(resolve: RateLimiterResolver, options: RateLimitOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const bindings = softBindingsFor(c.req.method, c.req.path);
    if (bindings.length === 0) return next();

    const key = clientKey(c.req.raw.headers);
    for (const binding of bindings) {
      const limiter = resolve(c, binding);
      if (!limiter) {
        if (options.bindingsRequired) logLine('error', 'rate_limit_binding_absent', { binding });
        continue;
      }
      let success: boolean;
      try {
        ({ success } = await limiter.limit(key));
      } catch (error) {
        logLine('error', 'rate_limit_error', { binding, errorClass: errorClass(error) });
        continue;
      }
      if (!success) {
        logLine('warn', 'rate_limit_refused', { binding });
        throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many requests. Try again later.');
      }
    }
    return next();
  };
}

// Exact, per-window limit on the sensitive routes (PostgreSQL). Fail closed: when the counter is
// unavailable or its query errors, the request is refused with 503 and never reaches the route.
export function windowRateLimitMiddleware(resolve: WindowCounterResolver, options: RateLimitOptions = {}): MiddlewareHandler {
  return async (c, next) => {
    const buckets = windowBucketsFor(c.req.method, c.req.path);
    if (buckets.length === 0) return next();

    const key = clientKey(c.req.raw.headers);
    if (key === UNKNOWN_CLIENT_KEY) {
      if (!options.bindingsRequired) return next();
      logLine('warn', 'rate_limit_client_ip_missing', {});
    }

    const requestId = c.get('requestId');
    const headers = { 'Cache-Control': 'no-store' };
    for (const bucket of buckets) {
      const config = WINDOW_BUCKETS[bucket];
      let counted;
      try {
        const counter = resolve(c);
        if (!counter) throw new Error('no database pool for rate limit');
        counted = await counter.consume(bucket, key, config.windowSeconds);
      } catch (error) {
        logLine('error', 'rate_limit_store_error', { bucket, errorClass: errorClass(error) });
        return c.json(
          { error: { code: 'SERVICE_UNAVAILABLE', message: 'Rate limit check unavailable. Try again shortly.', requestId } },
          503,
          { ...headers, 'Retry-After': '1' },
        );
      }
      if (counted.count > config.limit) {
        logLine('warn', 'rate_limit_window_refused', { bucket });
        return c.json(
          { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests. Try again later.', requestId } },
          429,
          { ...headers, 'Retry-After': String(counted.retryAfterSeconds) },
        );
      }
    }
    return next();
  };
}
