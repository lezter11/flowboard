import type { Context } from 'hono';
import type { RateLimiter, RateLimitBinding } from '../services/rate-limit.ts';

// Cloudflare Worker rate-limiting binding (`ratelimits` in wrangler.jsonc). Its limit() call
// resolves to { success }. The counter is per Cloudflare location and resets when the isolate
// is recycled: it stops bursts from one client but is not an exact global quota.
interface CloudflareRateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

// Returns undefined when the binding is absent (Node runtime, tests, or a config without it).
// Absence means no limiting, so the deployed wrangler.jsonc must always declare every binding.
export function cloudflareRateLimiter(c: Context, binding: RateLimitBinding): RateLimiter | undefined {
  const env = c.env as Record<string, unknown> | undefined;
  const candidate = env?.[binding] as Partial<CloudflareRateLimitBinding> | undefined;
  if (typeof candidate?.limit !== 'function') return undefined;
  const limiter = candidate as CloudflareRateLimitBinding;
  return { limit: (key) => limiter.limit({ key }) };
}
