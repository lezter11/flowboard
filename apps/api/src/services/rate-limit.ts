// Worker-side rate limiting: the port and the route rules. Business code and the middleware
// depend only on RateLimiter, never on a Cloudflare type, so the Node runtime and tests can
// supply their own limiter or none at all.

export interface RateLimiter {
  limit(key: string): Promise<{ success: boolean }>;
}

// Binding names are the wrangler.jsonc `ratelimits[].name` values. Each one is its own counter
// namespace, so one request can be counted by several bindings (for example a POST to
// invitations counts toward both FB_RL_WRITES and FB_RL_INVITE).
export const RATE_LIMIT_BINDINGS = {
  FB_RL_AUTH: { limit: 10, periodSeconds: 60 },
  FB_RL_WRITES: { limit: 60, periodSeconds: 60 },
  FB_RL_INVITE: { limit: 10, periodSeconds: 60 },
  FB_RL_IMPORT: { limit: 5, periodSeconds: 60 },
  FB_RL_UPLOAD: { limit: 10, periodSeconds: 60 },
} as const;

export type RateLimitBinding = keyof typeof RATE_LIMIT_BINDINGS;

interface RateLimitRule {
  binding: RateLimitBinding;
  matches(method: string, path: string): boolean;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Limits follow docs/RATE_LIMITING.md. Reads are not limited, except Google sign-in.
export const RATE_LIMIT_RULES: readonly RateLimitRule[] = [
  { binding: 'FB_RL_AUTH', matches: (_m, p) => p.startsWith('/api/v1/auth/google') },
  { binding: 'FB_RL_WRITES', matches: (m, p) => WRITE_METHODS.has(m) && p.startsWith('/api/v1/') },
  {
    binding: 'FB_RL_INVITE',
    matches: (m, p) => m === 'POST' && /^\/api\/v1\/projects\/[^/]+\/invitations$/.test(p),
  },
  {
    binding: 'FB_RL_IMPORT',
    matches: (m, p) =>
      m === 'POST' &&
      (/^\/api\/v1\/boards\/[^/]+\/(card-)?imports$/.test(p) || /^\/api\/v1\/(card-)?imports\/[^/]+\/commit$/.test(p)),
  },
  {
    binding: 'FB_RL_UPLOAD',
    matches: (m, p) =>
      m === 'POST' &&
      (/^\/api\/v1\/cards\/[^/]+\/image-uploads$/.test(p) || /^\/api\/v1\/image-uploads\/[^/]+\/finalize$/.test(p)),
  },
];

export function bindingsFor(method: string, path: string): RateLimitBinding[] {
  if (path.startsWith('/health/')) return [];
  return RATE_LIMIT_RULES.filter((rule) => rule.matches(method, path)).map((rule) => rule.binding);
}

// Cloudflare overwrites this header with the connecting client address at its edge, so a client
// cannot choose it on the public hostnames. X-Forwarded-For and similar headers are never read.
export const CLIENT_IP_HEADER = 'cf-connecting-ip';
export const UNKNOWN_CLIENT_KEY = 'unknown-client';
const IP_SHAPE = /^[0-9a-fA-F:.]{2,45}$/;

export function clientKey(headers: Headers): string {
  const value = headers.get(CLIENT_IP_HEADER)?.trim() ?? '';
  return IP_SHAPE.test(value) ? value : UNKNOWN_CLIENT_KEY;
}
