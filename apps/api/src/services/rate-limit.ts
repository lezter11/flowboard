// Rate limiting: ports, buckets and route mapping. Business code and middleware depend only on
// these types, never on Cloudflare or PostgreSQL.

// --- Soft, per-location limiter (Cloudflare binding; approximate, fail open) -----------------

export interface RateLimiter {
  limit(key: string): Promise<{ success: boolean }>;
}

// Binding names are the wrangler.jsonc `ratelimits[].name` values.
export const RATE_LIMIT_BINDINGS = {
  FB_RL_WRITES: { limit: 60, periodSeconds: 60 },
} as const;

export type RateLimitBinding = keyof typeof RATE_LIMIT_BINDINGS;

export const SOFT_WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function softBindingsFor(method: string, path: string): RateLimitBinding[] {
  if (path.startsWith('/health/')) return [];
  return SOFT_WRITE_METHODS.has(method) && path.startsWith('/api/v1/') ? ['FB_RL_WRITES'] : [];
}

// --- Exact, per-window limiter (PostgreSQL; fail closed on the sensitive routes) ------------

// Limits from docs/RATE_LIMITING.md. Each bucket counts per client key in a fixed window.
export const WINDOW_BUCKETS = {
  auth: { limit: 10, windowSeconds: 60 },
  invite: { limit: 10, windowSeconds: 60 },
  import: { limit: 5, windowSeconds: 60 },
  upload: { limit: 10, windowSeconds: 60 },
} as const;

export type WindowBucket = keyof typeof WINDOW_BUCKETS;

export interface WindowCount {
  // Requests counted in this window, including the current one.
  count: number;
  // Seconds until the window ends, at least 1.
  retryAfterSeconds: number;
}

export interface WindowCounter {
  consume(bucket: WindowBucket, clientKey: string, windowSeconds: number): Promise<WindowCount>;
}

export function windowBucketsFor(method: string, path: string): WindowBucket[] {
  if (path.startsWith('/health/')) return [];
  const buckets: WindowBucket[] = [];
  if (path.startsWith('/api/v1/auth/google')) buckets.push('auth');
  if (method === 'POST' && /^\/api\/v1\/projects\/[^/]+\/invitations$/.test(path)) buckets.push('invite');
  if (
    method === 'POST' &&
    (/^\/api\/v1\/boards\/[^/]+\/(card-)?imports$/.test(path) || /^\/api\/v1\/(card-)?imports\/[^/]+\/commit$/.test(path))
  ) {
    buckets.push('import');
  }
  if (
    method === 'POST' &&
    (/^\/api\/v1\/cards\/[^/]+\/image-uploads$/.test(path) || /^\/api\/v1\/image-uploads\/[^/]+\/finalize$/.test(path))
  ) {
    buckets.push('upload');
  }
  return buckets;
}

// --- Client key -----------------------------------------------------------------------------

// Cloudflare overwrites this header with the connecting client address at its edge. Forwarding
// headers such as X-Forwarded-For are never read.
export const CLIENT_IP_HEADER = 'cf-connecting-ip';
export const UNKNOWN_CLIENT_KEY = 'unknown-client';
const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

export function clientKey(headers: Headers): string {
  const value = headers.get(CLIENT_IP_HEADER)?.trim() ?? '';
  return IP_SHAPE.test(value) ? value : UNKNOWN_CLIENT_KEY;
}
