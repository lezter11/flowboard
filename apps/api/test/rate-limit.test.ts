import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/http/app.ts';
import { RATE_LIMIT_BINDINGS, type RateLimitBinding } from '../src/services/rate-limit.ts';

// Fake limiter: records every (binding, key) consulted and answers per binding.
function fakeLimiter(allow: (binding: RateLimitBinding) => boolean = () => true) {
  const calls: Array<{ binding: RateLimitBinding; key: string }> = [];
  const resolve = (_c: unknown, binding: RateLimitBinding) => ({
    limit: async (key: string) => {
      calls.push({ binding, key });
      return { success: allow(binding) };
    },
  });
  return { calls, resolve };
}

const CLIENT = { 'cf-connecting-ip': '203.0.113.7' };

test('rate limit: a request under the limit passes to its route', async () => {
  const { calls, resolve } = fakeLimiter();
  const app = createApp(async () => {}, { rateLimiter: resolve });
  const res = await app.request('/api/v1/auth/google', { headers: CLIENT, redirect: 'manual' });
  assert.notEqual(res.status, 429);
  assert.deepEqual(calls, [{ binding: 'FB_RL_AUTH', key: '203.0.113.7' }]);
});

test('rate limit: a limit hit returns 429 TOO_MANY_REQUESTS with Retry-After and the error envelope', async () => {
  const { resolve } = fakeLimiter((binding) => binding !== 'FB_RL_WRITES');
  const app = createApp(async () => {}, { rateLimiter: resolve });
  const res = await app.request('/api/v1/session/logout', { method: 'POST', headers: CLIENT });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '60');
  const body = (await res.json()) as { error: { code: string; message: string; requestId: string } };
  assert.equal(body.error.code, 'TOO_MANY_REQUESTS');
  assert.ok(body.error.message.length > 0);
  assert.ok(body.error.requestId.length > 0);
});

test('rate limit: health probes are never limited, even when every limiter refuses', async () => {
  const { calls, resolve } = fakeLimiter(() => false);
  const app = createApp(async () => {}, { rateLimiter: resolve });
  for (const path of ['/health/live', '/health/ready']) {
    const res = await app.request(path, { headers: CLIENT });
    assert.notEqual(res.status, 429, path);
  }
  assert.equal(calls.length, 0);
});

test('rate limit: the key is the Cloudflare client IP and ignores spoofable forwarding headers', async () => {
  const { calls, resolve } = fakeLimiter();
  const app = createApp(async () => {}, { rateLimiter: resolve });
  await app.request('/api/v1/auth/google', {
    headers: { ...CLIENT, 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2', forwarded: 'for=198.51.100.3' },
    redirect: 'manual',
  });
  await app.request('/api/v1/auth/google', {
    headers: { 'x-forwarded-for': '198.51.100.9' },
    redirect: 'manual',
  });
  await app.request('/api/v1/auth/google', {
    headers: { 'cf-connecting-ip': 'not an address; drop table' },
    redirect: 'manual',
  });
  assert.deepEqual(calls.map((c) => c.key), ['203.0.113.7', 'unknown-client', 'unknown-client']);
});

test('rate limit: reads outside Google sign-in are not limited', async () => {
  const { calls, resolve } = fakeLimiter(() => false);
  const app = createApp(async () => {}, { rateLimiter: resolve });
  const res = await app.request('/api/v1/session', { headers: CLIENT });
  assert.notEqual(res.status, 429);
  assert.equal(calls.length, 0);
});

test('rate limit: each route family consults its own binding and the general write limit', async () => {
  const expectations: Array<[string, string, RateLimitBinding[]]> = [
    ['POST', '/api/v1/projects/p1/invitations', ['FB_RL_WRITES', 'FB_RL_INVITE']],
    ['POST', '/api/v1/boards/b1/imports', ['FB_RL_WRITES', 'FB_RL_IMPORT']],
    ['POST', '/api/v1/card-imports/i1/commit', ['FB_RL_WRITES', 'FB_RL_IMPORT']],
    ['POST', '/api/v1/cards/c1/image-uploads', ['FB_RL_WRITES', 'FB_RL_UPLOAD']],
    ['POST', '/api/v1/image-uploads/u1/finalize', ['FB_RL_WRITES', 'FB_RL_UPLOAD']],
    ['PATCH', '/api/v1/cards/c1', ['FB_RL_WRITES']],
    ['GET', '/api/v1/auth/google/callback', ['FB_RL_AUTH']],
  ];
  for (const [method, path, expected] of expectations) {
    const { calls, resolve } = fakeLimiter();
    const app = createApp(async () => {}, { rateLimiter: resolve });
    await app.request(path, { method, headers: CLIENT, redirect: 'manual' });
    assert.deepEqual(calls.map((c) => c.binding), expected, `${method} ${path}`);
  }
});

test('rate limit: with no binding (Node runtime) requests pass unlimited', async () => {
  const app = createApp(async () => {});
  const res = await app.request('/api/v1/auth/google', { headers: CLIENT, redirect: 'manual' });
  assert.notEqual(res.status, 429);
});

test('rate limit: deployed wrangler config declares every binding in production and UAT with the documented limits', () => {
  const configPath = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
  const source = readFileSync(configPath, 'utf8').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  const config = JSON.parse(source) as {
    ratelimits: Array<{ name: string; namespace_id: string; simple: { limit: number; period: number } }>;
    env: { uat: { ratelimits: typeof config.ratelimits } };
  };
  const environments = { production: config.ratelimits, uat: config.env.uat.ratelimits };
  for (const [environment, limiters] of Object.entries(environments)) {
    assert.deepEqual(
      limiters.map((l) => l.name).sort(),
      Object.keys(RATE_LIMIT_BINDINGS).sort(),
      `${environment} binding names`,
    );
    for (const limiter of limiters) {
      const expected = RATE_LIMIT_BINDINGS[limiter.name as RateLimitBinding];
      assert.deepEqual(limiter.simple, { limit: expected.limit, period: expected.periodSeconds }, `${environment} ${limiter.name}`);
    }
  }
  const namespaces = [...config.ratelimits, ...config.env.uat.ratelimits].map((l) => l.namespace_id);
  assert.equal(new Set(namespaces).size, namespaces.length, 'namespace ids must be unique across environments');
});

test('rate limit: the default resolver uses the Cloudflare binding from the Worker environment', async () => {
  const seen: Array<{ key: string }> = [];
  const env = {
    FB_RL_AUTH: {
      limit: async (options: { key: string }) => {
        seen.push(options);
        return { success: false };
      },
    },
  };
  const app = createApp(async () => {});
  const denied = await app.request('/api/v1/auth/google', { headers: CLIENT, redirect: 'manual' }, env);
  assert.equal(denied.status, 429);
  assert.deepEqual(seen, [{ key: '203.0.113.7' }]);

  const allowedEnv = { FB_RL_AUTH: { limit: async () => ({ success: true }) } };
  const allowed = await app.request('/api/v1/auth/google', { headers: CLIENT, redirect: 'manual' }, allowedEnv);
  assert.notEqual(allowed.status, 429);
});

test('rate limit: on the Worker an absent binding is logged loudly and the request still passes', async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (line: string) => logged.push(line);
  try {
    const app = createApp(async () => {}, { rateLimiter: () => undefined, rateLimitBindingsRequired: true });
    const res = await app.request('/api/v1/auth/google', { headers: CLIENT, redirect: 'manual' });
    assert.notEqual(res.status, 429);
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged.map((line) => JSON.parse(line)), [
    { level: 'error', event: 'rate_limit_binding_absent', binding: 'FB_RL_AUTH' },
  ]);
});

test('rate limit: the Node runtime skips absent bindings without logging', async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (line: string) => logged.push(line);
  try {
    const app = createApp(async () => {}, { rateLimiter: () => undefined });
    await app.request('/api/v1/auth/google', { headers: CLIENT, redirect: 'manual' });
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, []);
});

test('rate limit: a refusal is logged by binding name only, never with the client IP', async () => {
  const logged: string[] = [];
  const original = console.warn;
  console.warn = (line: string) => logged.push(line);
  try {
    const { resolve } = fakeLimiter(() => false);
    const app = createApp(async () => {}, { rateLimiter: resolve });
    const res = await app.request('/api/v1/auth/google', { headers: CLIENT, redirect: 'manual' });
    assert.equal(res.status, 429);
  } finally {
    console.warn = original;
  }
  assert.equal(logged.length, 1);
  assert.deepEqual(JSON.parse(logged[0]!), { level: 'warn', event: 'rate_limit_refused', binding: 'FB_RL_AUTH' });
  assert.ok(!logged[0]!.includes('203.0.113.7'));
});

test('rate limit: binding status reports booleans for the bindings the runtime can see', async () => {
  const { rateLimitBindingStatus } = await import('../src/adapters/rate-limit-cloudflare.ts');
  const status = rateLimitBindingStatus({ FB_RL_AUTH: { limit: async () => ({ success: true }) }, FB_RL_WRITES: 'not a binding' });
  assert.deepEqual(status, {
    FB_RL_AUTH: true,
    FB_RL_WRITES: false,
    FB_RL_INVITE: false,
    FB_RL_IMPORT: false,
    FB_RL_UPLOAD: false,
  });
});

test('rate limit: the admin status route reports binding presence and needs the admin secret', async () => {
  const secret = 'a'.repeat(32);
  const fakePool = { query: async () => ({ rows: [] }) } as unknown as import('pg').Pool;
  const app = createApp(async () => {}, { pool: fakePool });
  const env = { DEV_LOGIN_SECRET: secret, FB_RL_AUTH: { limit: async () => ({ success: true }) } };

  const denied = await app.request('/api/v1/system/status', {}, env);
  assert.equal(denied.status, 403);

  const allowed = await app.request('/api/v1/system/status', { headers: { 'x-dev-secret': secret } }, env);
  assert.equal(allowed.status, 200);
  const body = (await allowed.json()) as { data: { rateLimitBindings: Record<string, boolean> } };
  assert.equal(body.data.rateLimitBindings['FB_RL_AUTH'], true);
  assert.equal(body.data.rateLimitBindings['FB_RL_UPLOAD'], false);
});

test('rate limit: a missing client IP on the Worker is logged without the value', async () => {
  const logged: string[] = [];
  const original = console.warn;
  console.warn = (line: string) => logged.push(line);
  try {
    const { resolve } = fakeLimiter();
    const app = createApp(async () => {}, { rateLimiter: resolve, rateLimitBindingsRequired: true });
    await app.request('/api/v1/auth/google', { redirect: 'manual' });
  } finally {
    console.warn = original;
  }
  assert.deepEqual(logged.map((line) => JSON.parse(line)), [{ level: 'warn', event: 'rate_limit_client_ip_missing' }]);
});
