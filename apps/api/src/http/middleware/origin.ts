import type { Context, MiddlewareHandler } from 'hono';
import { HttpError } from '../errors.ts';

// Matches every cookie name authMiddleware accepts (flowboard_session and the legacy `session`).
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isLocalOrigin(origin: string): boolean {
  return origin.startsWith('http://localhost:')
    || origin.startsWith('http://127.0.0.1:')
    || origin.startsWith('https://localhost:');
}

export function configuredOrigins(c: Context): string[] {
  const env = c.env as { CORS_ORIGIN?: string } | undefined;
  const configured = env?.CORS_ORIGIN ?? (typeof process !== 'undefined' ? process.env?.['CORS_ORIGIN'] : undefined) ?? '';
  return configured.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Origins trusted for credentialed browser traffic: local development and the explicit CORS_ORIGIN list. */
export function isTrustedOrigin(origin: string, c: Context): boolean {
  return isLocalOrigin(origin) || configuredOrigins(c).includes(origin);
}

/**
 * Cookie-authenticated state changes must come from this site. Browsers attach the session cookie
 * to any request a hostile page can trigger, so for POST/PUT/PATCH/DELETE carrying the session
 * cookie the request's Origin (or Referer) must be the origin the user sees (the Pages host that
 * proxies to us keeps its own URL) or a trusted origin. A request with neither header is accepted
 * only when the browser does not mark it as cross-site via Sec-Fetch-Site; non-browser clients send none.
 */
export const originCheckMiddleware: MiddlewareHandler = async (c, next) => {
  if (!UNSAFE_METHODS.has(c.req.method) || !/(^|;\s*)(flowboard_session|session)=/.test(c.req.header('cookie') ?? '')) {
    return next();
  }
  const own = new URL(c.req.url).origin;
  const sources = [c.req.header('origin'), c.req.header('referer')];
  const declared = sources.find((value) => value !== undefined && value !== '');
  if (declared !== undefined) {
    let origin: string;
    try {
      origin = declared === 'null' ? 'null' : new URL(declared).origin;
    } catch {
      origin = 'null';
    }
    if (origin === own || isTrustedOrigin(origin, c)) return next();
    throw HttpError.forbidden('Cross-site request rejected.', 'FORBIDDEN');
  }
  const fetchSite = c.req.header('sec-fetch-site');
  if (fetchSite === 'cross-site' || fetchSite === 'same-site') {
    throw HttpError.forbidden('Cross-site request rejected.', 'FORBIDDEN');
  }
  return next();
};
