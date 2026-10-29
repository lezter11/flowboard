import type { Context } from 'hono';
import { RATE_LIMIT_BINDINGS, type RateLimiter, type RateLimitBinding } from '../services/rate-limit.ts';

// Cloudflare Worker rate-limiting binding (`ratelimits` in wrangler.jsonc). Its limit() call
// resolves to { success }. Counters are approximate and kept separately in each Cloudflare
// location, so a client whose requests are served from several locations can exceed the
// configured limit. See docs/decisions/2026-10-29-rate-limiter-uat-finding.md.
interface CloudflareRateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

function bindingFrom(env: unknown, binding: RateLimitBinding): CloudflareRateLimitBinding | undefined {
  const candidate = (env as Record<string, unknown> | undefined)?.[binding] as Partial<CloudflareRateLimitBinding> | undefined;
  return typeof candidate?.limit === 'function' ? (candidate as CloudflareRateLimitBinding) : undefined;
}

// Returns undefined when the binding is absent (Node runtime, tests, or a config without it).
export function cloudflareRateLimiter(c: Context, binding: RateLimitBinding): RateLimiter | undefined {
  const limiter = bindingFrom(c.env, binding);
  if (!limiter) return undefined;
  return { limit: (key) => limiter.limit({ key }) };
}

// Booleans only, for the admin-protected status route: which declared bindings the runtime sees.
export function rateLimitBindingStatus(env: unknown): Record<RateLimitBinding, boolean> {
  const status = {} as Record<RateLimitBinding, boolean>;
  for (const binding of Object.keys(RATE_LIMIT_BINDINGS) as RateLimitBinding[]) {
    status[binding] = bindingFrom(env, binding) !== undefined;
  }
  return status;
}
