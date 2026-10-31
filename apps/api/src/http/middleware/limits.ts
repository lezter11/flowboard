import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { timeout } from 'hono/timeout';
import { HttpError } from '../errors.ts';

export const DEFAULT_BODY_LIMIT_BYTES = 1024 * 1024; // 1 MiB (1,048,576 bytes)
export const DEFAULT_DEADLINE_MS = 5000; // 5000 ms

// Route-aware caps (B-7, FB-AUD-08). The file caps are checked exactly by the parser or validator.
// The body cap adds 64 KiB so a file at its exact limit still fits inside a multipart envelope.
const MULTIPART_ALLOWANCE_BYTES = 64 * 1024;
export const IMPORT_BODY_LIMIT_BYTES = 5 * 1024 * 1024 + MULTIPART_ALLOWANCE_BYTES; // XLSX up to 5 MiB
export const IMAGE_BODY_LIMIT_BYTES = 10 * 1024 * 1024 + MULTIPART_ALLOWANCE_BYTES; // image up to 10 MiB

// Only a request carrying a session cookie may use a large cap. An anonymous request keeps the
// default, so an unauthenticated caller cannot make the Worker buffer 10 MiB before auth refuses it.
const SESSION_COOKIE = /(^|;\s*)(flowboard_session|session)=/;

/** The body cap for one request. Pure, so the boundaries can be tested directly. */
export function bodyLimitFor(method: string, path: string, cookieHeader: string | undefined, defaultBytes = DEFAULT_BODY_LIMIT_BYTES): number {
  if (!SESSION_COOKIE.test(cookieHeader ?? '')) return defaultBytes;
  if (method === 'POST' && /^\/api\/v1\/boards\/[^/]+\/(card-)?imports$/.test(path)) return IMPORT_BODY_LIMIT_BYTES;
  if (method === 'PUT' && /^\/api\/v1\/image-uploads\/[^/]+\/content$/.test(path)) return IMAGE_BODY_LIMIT_BYTES;
  return defaultBytes;
}

/** Applies bodyLimitFor per request. Each distinct cap is built once and reused. */
export function routeBodyLimitMiddleware(defaultBytes: number = DEFAULT_BODY_LIMIT_BYTES): MiddlewareHandler {
  const limiters = new Map<number, MiddlewareHandler>();
  return (c, next) => {
    const bytes = bodyLimitFor(c.req.method, c.req.path, c.req.header('cookie'), defaultBytes);
    let limiter = limiters.get(bytes);
    if (!limiter) {
      limiter = bodyLimitMiddleware(bytes);
      limiters.set(bytes, limiter);
    }
    return limiter(c, next);
  };
}

export function bodyLimitMiddleware(maxBytes: number = DEFAULT_BODY_LIMIT_BYTES) {
  return bodyLimit({
    maxSize: maxBytes,
    onError: () => {
      throw new HttpError(
        413,
        'PAYLOAD_TOO_LARGE',
        'The request is too large.',
      );
    },
  });
}

export function deadlineMiddleware(deadlineMs: number = DEFAULT_DEADLINE_MS) {
  return timeout(
    deadlineMs,
    () => new HttpError(504, 'DEADLINE_EXCEEDED', 'The request took too long. Try again.'),
  );
}
