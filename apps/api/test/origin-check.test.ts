import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/http/app.ts';

// The check runs before routing and auth, so these requests need no database: an allowed request
// reaches the router and gets an ordinary 401/404, a rejected one gets 403 first.
test('cookie-authenticated state changes require a same-site Origin or Referer', async () => {
  process.env['CORS_ORIGIN'] = 'https://app.flowboard.example';
  try {
    const app = createApp();
    const send = (headers: Record<string, string>, method = 'POST') =>
      app.request('https://app.flowboard.example/api/v1/session/logout', {
        method,
        headers: { cookie: 'flowboard_session=synthetic', ...headers },
      });

    for (const hostile of [
      { origin: 'https://evil.example' },
      { origin: 'https://evil.pages.dev' },
      { origin: 'null' },
      { referer: 'https://evil.example/page' },
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
    ]) {
      const res = await send(hostile);
      assert.equal(res.status, 403, JSON.stringify(hostile));
      assert.equal(((await res.json()) as any).error.code, 'FORBIDDEN');
    }

    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      assert.equal((await send({ origin: 'https://evil.example' }, method)).status, 403, method);
    }

    // The legacy cookie name is accepted by authMiddleware, so it is covered too.
    const legacy = await app.request('https://app.flowboard.example/api/v1/session/logout', {
      method: 'POST',
      headers: { cookie: 'session=synthetic', origin: 'https://evil.example' },
    });
    assert.equal(legacy.status, 403);

    for (const ok of [
      { origin: 'https://app.flowboard.example' }, // same origin as the URL the user sees
      { origin: 'http://localhost:3000' },
      { referer: 'https://app.flowboard.example/boards/b1' },
      { 'sec-fetch-site': 'same-origin' },
      {}, // non-browser client: no Origin, Referer or Sec-Fetch-Site
    ]) {
      assert.notEqual((await send(ok)).status, 403, JSON.stringify(ok));
    }

    // Safe methods and cookie-less requests are not subject to the check.
    const read = await app.request('https://app.flowboard.example/health/live', { headers: { cookie: 'flowboard_session=x', origin: 'https://evil.example' } });
    assert.equal(read.status, 200);
    const anonymous = await app.request('https://app.flowboard.example/api/v1/session/logout', { method: 'POST', headers: { origin: 'https://evil.example' } });
    assert.notEqual(anonymous.status, 403);
  } finally {
    delete process.env['CORS_ORIGIN'];
  }
});

test('Pages-proxied requests keep the user-facing URL, so same-origin Origin passes without CORS_ORIGIN', async () => {
  const app = createApp();
  const res = await app.request('https://flowboard-app.pages.dev/api/v1/session/logout', {
    method: 'POST',
    headers: { cookie: 'flowboard_session=x', origin: 'https://flowboard-app.pages.dev' },
  });
  assert.notEqual(res.status, 403);
});
