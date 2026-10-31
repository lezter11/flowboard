import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/http/app.ts';
import { RATE_LIMIT_BINDINGS, type RateLimitBinding, type WindowBucket, type WindowCounter } from '../src/services/rate-limit.ts';
import { windowBucketsFor } from '../src/services/rate-limit.ts';

const CLIENT = { 'cf-connecting-ip': '203.0.113.7' };

// Soft (Cloudflare) limiter fake: records (binding, key) and answers per binding.
function fakeSoft(allow: (binding: RateLimitBinding) => boolean = () => true) {
  const calls: Array<{ binding: RateLimitBinding; key: string }> = [];
  const resolve = (_c: unknown, binding: RateLimitBinding) => ({
    limit: async (key: string) => {
      calls.push({ binding, key });
      return { success: allow(binding) };
    },
  });
  return { calls, resolve };
}

// Window (PostgreSQL) counter fake: records buckets and keys; answers with a fixed count.
function fakeWindow(count = 1, retryAfterSeconds = 17) {
  const calls: Array<{ bucket: WindowBucket; key: string; windowSeconds: number }> = [];
  const counter: WindowCounter = {
    consume: async (bucket, key, windowSeconds) => {
      calls.push({ bucket, key, windowSeconds });
      return { count, retryAfterSeconds };
    },
  };
  return { calls, resolve: () => counter };
}

// Soft limiter allows everything and no window counter is needed: the default app for most tests.
const allowAll = { rateLimiter: fakeSoft().resolve, windowCounter: fakeWindow().resolve };

test('soft limit: a refused general write returns 429 TOO_MANY_REQUESTS with Retry-After 60', async () => {
  const app = createApp(async () => {}, { ...allowAll, rateLimiter: fakeSoft((b) => b !== 'FB_RL_WRITES').resolve });
  const res = await app.request('/api/v1/session/logout', { method: 'POST', headers: CLIENT });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '60');
  const body = (await res.json()) as { error: { code: string; requestId: string } };
  assert.equal(body.error.code, 'RATE_LIMITED');
  assert.ok(body.error.requestId.length > 0);
});

test('soft limit: a throwing binding fails open and logs the error class only', async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (line: string) => logged.push(line);
  try {
    const app = createApp(async () => {}, {
      ...allowAll,
      rateLimiter: () => ({ limit: async () => { throw new TypeError('secret 203.0.113.7'); } }),
    });
    const baseline = await createApp(async () => {}, { ...allowAll, rateLimiter: () => undefined })
      .request('/api/v1/session/logout', { method: 'POST', headers: CLIENT });
    const res = await app.request('/api/v1/session/logout', { method: 'POST', headers: CLIENT });
    assert.equal(res.status, baseline.status);
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged.map((line) => JSON.parse(line)), [
    { level: 'error', event: 'rate_limit_error', binding: 'FB_RL_WRITES', errorClass: 'TypeError' },
  ]);
  assert.ok(!logged.join('').includes('203.0.113.7'));
});

test('limits: health probes are never counted by either limiter', async () => {
  const soft = fakeSoft(() => false);
  const window = fakeWindow(999);
  const app = createApp(async () => {}, { rateLimiter: soft.resolve, windowCounter: window.resolve });
  for (const path of ['/health/live', '/health/ready']) {
    const res = await app.request(path, { headers: CLIENT });
    assert.notEqual(res.status, 429, path);
  }
  assert.equal(soft.calls.length, 0);
  assert.equal(window.calls.length, 0);
});

test('limits: the key is the Cloudflare client IP and ignores spoofable forwarding headers', async () => {
  const window = fakeWindow();
  const app = createApp(async () => {}, { ...allowAll, windowCounter: window.resolve });
  await app.request('/api/v1/auth/google', { headers: { ...CLIENT, 'x-forwarded-for': '198.51.100.1' }, redirect: 'manual' });
  await app.request('/api/v1/auth/google', { headers: { 'x-forwarded-for': '198.51.100.9' }, redirect: 'manual' });
  await app.request('/api/v1/auth/google', { headers: { 'cf-connecting-ip': 'not an address; drop table' }, redirect: 'manual' });
  assert.deepEqual(window.calls.map((c) => c.key), ['203.0.113.7']);
});

test('limits: reads outside Google sign-in are not counted', async () => {
  const window = fakeWindow(999);
  const soft = fakeSoft(() => false);
  const app = createApp(async () => {}, { rateLimiter: soft.resolve, windowCounter: window.resolve });
  const res = await app.request('/api/v1/session', { headers: CLIENT });
  assert.notEqual(res.status, 429);
  assert.equal(window.calls.length, 0);
  assert.equal(soft.calls.length, 0);
});

test('buckets: each sensitive route family maps to its bucket and nothing else', () => {
  const cases: Array<[string, string, WindowBucket[]]> = [
    ['GET', '/api/v1/auth/google', ['auth']],
    ['GET', '/api/v1/auth/google/callback', ['auth']],
    ['POST', '/api/v1/projects/p1/invitations', ['invite']],
    ['POST', '/api/v1/boards/b1/imports', ['import']],
    ['POST', '/api/v1/boards/b1/card-imports', ['import']],
    ['POST', '/api/v1/card-imports/i1/commit', ['import']],
    ['POST', '/api/v1/imports/i1/commit', ['import']],
    ['POST', '/api/v1/cards/c1/image-uploads', ['upload']],
    ['POST', '/api/v1/image-uploads/u1/finalize', ['upload']],
    ['PUT', '/api/v1/image-uploads/u1/content', []],
    ['PATCH', '/api/v1/cards/c1', []],
    ['GET', '/api/v1/session', []],
    ['GET', '/health/live', []],
  ];
  for (const [method, path, expected] of cases) {
    assert.deepEqual(windowBucketsFor(method, path), expected, `${method} ${path}`);
  }
});

test('window: a count over the limit returns 429 with Retry-After from the counter', async () => {
  const window = fakeWindow(11, 17);
  const app = createApp(async () => {}, { ...allowAll, windowCounter: window.resolve });
  const res = await app.request('/api/v1/auth/google', { headers: CLIENT, redirect: 'manual' });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '17');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = (await res.json()) as { error: { code: string; requestId: string } };
  assert.equal(body.error.code, 'RATE_LIMITED');
  assert.ok(body.error.requestId.length > 0);
});

test('window: a count within the limit reaches the route', async () => {
  const window = fakeWindow(10);
  const app = createApp(async () => {}, { ...allowAll, windowCounter: window.resolve });
  const res = await app.request('/api/v1/auth/google', { headers: CLIENT, redirect: 'manual' });
  assert.notEqual(res.status, 429);
  assert.deepEqual(window.calls, [{ bucket: 'auth', key: '203.0.113.7', windowSeconds: 60 }]);
});

test('window: the invitation route counts in the invite bucket with its 60-second window', async () => {
  const window = fakeWindow(1);
  const app = createApp(async () => {}, { ...allowAll, windowCounter: window.resolve });
  await app.request('/api/v1/projects/p1/invitations', { method: 'POST', headers: CLIENT });
  assert.deepEqual(window.calls.map((c) => [c.bucket, c.windowSeconds]), [['invite', 60]]);
});

test('window: when the counter throws, the request fails closed with 503 and the route is not reached', async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (line: string) => logged.push(line);
  try {
    const app = createApp(async () => {}, {
      ...allowAll,
      windowCounter: () => ({ consume: async () => { throw new Error('connection refused 203.0.113.7'); } }),
    });
    const res = await app.request('/api/v1/auth/google', { headers: CLIENT, redirect: 'manual' });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '1');
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'SERVICE_UNAVAILABLE');
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged.map((line) => JSON.parse(line)), [
    { level: 'error', event: 'rate_limit_store_error', bucket: 'auth', errorClass: 'Error' },
  ]);
  assert.ok(!logged.join('').includes('203.0.113.7'));
});

test('window: no database pool on a Worker fails closed; on Node a request without a client address is not counted', async () => {
  const worker = createApp(async () => {}, { rateLimiter: fakeSoft().resolve, windowCounter: () => undefined, rateLimitBindingsRequired: true });
  const denied = await worker.request('/api/v1/auth/google', { headers: CLIENT, redirect: 'manual' });
  assert.equal(denied.status, 503);

  const counted = fakeWindow(999);
  const node = createApp(async () => {}, { rateLimiter: fakeSoft().resolve, windowCounter: counted.resolve });
  const unlimited = await node.request('/api/v1/auth/google', { redirect: 'manual' });
  assert.notEqual(unlimited.status, 429);
  assert.equal(counted.calls.length, 0);
});

test('window: on the Worker a missing client address uses the shared fallback key and logs it without a value', async () => {
  const logged: string[] = [];
  const original = console.warn;
  console.warn = (line: string) => logged.push(line);
  const window = fakeWindow(1);
  try {
    const app = createApp(async () => {}, { ...allowAll, windowCounter: window.resolve, rateLimitBindingsRequired: true });
    await app.request('/api/v1/auth/google', { redirect: 'manual' });
  } finally {
    console.warn = original;
  }
  assert.deepEqual(window.calls.map((c) => c.key), ['unknown-client']);
  assert.deepEqual(logged.map((line) => JSON.parse(line)), [{ level: 'warn', event: 'rate_limit_client_ip_missing' }]);
});

test('soft binding: on the Worker an absent binding is logged loudly and the request still passes', async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (line: string) => logged.push(line);
  try {
    const app = createApp(async () => {}, { ...allowAll, rateLimiter: () => undefined, rateLimitBindingsRequired: true });
    const res = await app.request('/api/v1/session/logout', { method: 'POST', headers: CLIENT });
    assert.notEqual(res.status, 429);
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged.map((line) => JSON.parse(line)), [
    { level: 'error', event: 'rate_limit_binding_absent', binding: 'FB_RL_WRITES' },
  ]);
});

test('soft binding: the default resolver reads the Cloudflare binding from the Worker environment', async () => {
  const seen: Array<{ key: string }> = [];
  const env = {
    FB_RL_WRITES: { limit: async (options: { key: string }) => { seen.push(options); return { success: false }; } },
  };
  const app = createApp(async () => {}, { windowCounter: fakeWindow().resolve });
  const denied = await app.request('/api/v1/session/logout', { method: 'POST', headers: CLIENT }, env);
  assert.equal(denied.status, 429);
  assert.deepEqual(seen, [{ key: '203.0.113.7' }]);
});

test('binding status: booleans for the Cloudflare binding the runtime can see', async () => {
  const { rateLimitBindingStatus } = await import('../src/adapters/rate-limit-cloudflare.ts');
  assert.deepEqual(rateLimitBindingStatus({ FB_RL_WRITES: { limit: async () => ({ success: true }) } }), { FB_RL_WRITES: true });
});

test('admin status route reports the binding and needs the admin secret', async () => {
  const secret = 'a'.repeat(32);
  const fakePool = { query: async () => ({ rows: [] }) } as unknown as import('pg').Pool;
  const app = createApp(async () => {}, { pool: fakePool });
  const env = { DEV_LOGIN_SECRET: secret, FB_RL_WRITES: { limit: async () => ({ success: true }) } };
  assert.equal((await app.request('/api/v1/system/status', {}, env)).status, 403);
  const allowed = await app.request('/api/v1/system/status', { headers: { 'x-dev-secret': secret } }, env);
  assert.equal(allowed.status, 200);
  const body = (await allowed.json()) as { data: { rateLimitBindings: Record<string, boolean> } };
  assert.deepEqual(body.data.rateLimitBindings, { FB_RL_WRITES: true });
});

test('config: wrangler declares only the soft writes binding, with the documented limit, in production and UAT', () => {
  const configPath = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url));
  const source = readFileSync(configPath, 'utf8').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  const config = JSON.parse(source) as {
    ratelimits: Array<{ name: string; namespace_id: string; simple: { limit: number; period: number } }>;
    env: { uat: { ratelimits: typeof config.ratelimits } };
  };
  for (const [environment, limiters] of Object.entries({ production: config.ratelimits, uat: config.env.uat.ratelimits })) {
    assert.deepEqual(limiters.map((l) => l.name), Object.keys(RATE_LIMIT_BINDINGS), environment);
    assert.deepEqual(limiters[0]?.simple, { limit: 60, period: 60 }, environment);
  }
  const namespaces = [...config.ratelimits, ...config.env.uat.ratelimits].map((l) => l.namespace_id);
  assert.equal(new Set(namespaces).size, namespaces.length);
});
