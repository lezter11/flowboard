import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { closePool, getPool } from '../src/adapters/postgres.ts';
import { createApp } from '../src/http/app.ts';

// Real PostgreSQL callback path. Google is mocked with fetch; the test checks the redirect
// target after the OAuth round trip. Nothing here calls Google.
const realFetch = globalThis.fetch;
const OAUTH_STATE_COOKIE = 'flowboard_oauth_state';

function googleFetch(profile: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'synthetic' });
    if (url.includes('googleapis.com/oauth2/v3/userinfo')) return Response.json(profile);
    throw new Error(`unexpected outbound request: ${url}`);
  }) as typeof fetch;
}

const encodeCookieNext = (next: string) => Buffer.from(next, 'utf8').toString('base64url');

test('Google ?next= round trip, tampering and fallback', async (t) => {
  const app = createApp();
  before(async () => {
    process.env['GOOGLE_CLIENT_ID'] = 'synthetic-client';
    process.env['GOOGLE_CLIENT_SECRET'] = 'synthetic-secret';
    delete process.env['FRONTEND_URL'];
    await runMigrations(getPool());
  });
  after(async () => {
    globalThis.fetch = realFetch;
    delete process.env['GOOGLE_CLIENT_ID'];
    delete process.env['GOOGLE_CLIENT_SECRET'];
    await closePool();
  });

  async function start(query: string, path = '/api/v1/auth/google') {
    const res = await app.request(`http://localhost:8787${path}${query}`);
    assert.equal(res.status, 302);
    const state = new URL(res.headers.get('location')!).searchParams.get('state')!;
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    return { state, cookie };
  }

  async function callback(state: string, cookie: string, profileEmail: string) {
    globalThis.fetch = googleFetch({ sub: profileEmail, email: profileEmail, email_verified: true });
    return app.request(`http://localhost:8787/api/v1/auth/google/callback?code=abc&state=${state}`, {
      headers: { cookie },
      redirect: 'manual',
    });
  }

  await t.test('a legitimate /board?id=abc survives the round trip', async () => {
    const { state, cookie } = await start('?next=' + encodeURIComponent('/board?id=abc'));
    assert.match(cookie, new RegExp(`^${OAUTH_STATE_COOKIE}=`));
    const res = await callback(state, cookie, `rt.${Date.now()}@flowboard.example`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/board?id=abc');
  });

  await t.test('the /google/start alias carries next the same way', async () => {
    const { state, cookie } = await start('?next=/inbox', '/api/v1/auth/google/start');
    const res = await callback(state, cookie, `alias.${Date.now()}@flowboard.example`);
    assert.equal(res.headers.get('location'), '/inbox');
  });

  await t.test('hostile next values never reach the redirect; the default landing is used', async () => {
    const hostile = ['//evil.test', '/\\evil.test', 'https://evil.test', 'javascript:alert(1)', '%2f%2fevil.test', '/admin'];
    for (const payload of hostile) {
      const { state, cookie } = await start('?next=' + encodeURIComponent(payload));
      // Start drops the value, so no next is stored in the cookie.
      assert.equal(cookie.includes('.'), false, `no next stored for ${payload}`);
      const res = await callback(state, cookie, `hostile.${crypto.randomUUID()}@flowboard.example`);
      assert.equal(res.headers.get('location'), '/projects', `fallback for ${payload}`);
    }
  });

  await t.test('a forged cookie with a hostile next is revalidated and ignored at the callback', async () => {
    const { state } = await start('');
    const forged = `${OAUTH_STATE_COOKIE}=${state}.${encodeCookieNext('//evil.test')}`;
    const res = await callback(state, forged, `forged.${crypto.randomUUID()}@flowboard.example`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/projects');
  });

  await t.test('a cookie with a valid next but a different state is refused', async () => {
    const { cookie } = await start('?next=/board?id=abc');
    const res = await callback('forged-state', cookie, `tamper.${crypto.randomUUID()}@flowboard.example`);
    assert.equal(res.status, 403);
    assert.equal((await res.json() as any).error.code, 'CSRF_MISMATCH');
    assert.equal(res.headers.get('location'), null);
  });

  await t.test('a state swapped for the cookie next value is refused', async () => {
    const { state } = await start('?next=/board?id=abc');
    const swapped = `${OAUTH_STATE_COOKIE}=${encodeCookieNext('/board?id=abc')}.${state}`;
    const res = await callback(state, swapped, `swap.${crypto.randomUUID()}@flowboard.example`);
    assert.equal(res.status, 403);
  });

  await t.test('a missing next keeps the existing behaviour', async () => {
    const { state, cookie } = await start('');
    assert.equal(cookie.includes('.'), false);
    const res = await callback(state, cookie, `plain.${crypto.randomUUID()}@flowboard.example`);
    assert.equal(res.headers.get('location'), '/projects');
  });

  await t.test('FRONTEND_URL is prefixed only to a validated path', async () => {
    process.env['FRONTEND_URL'] = 'https://app.flowboard.example/';
    try {
      const { state, cookie } = await start('?next=/board?id=abc');
      const ok = await callback(state, cookie, `fe.${crypto.randomUUID()}@flowboard.example`);
      assert.equal(ok.headers.get('location'), 'https://app.flowboard.example/board?id=abc');

      const bad = await start('?next=' + encodeURIComponent('//evil.test'));
      const fallback = await callback(bad.state, bad.cookie, `fe2.${crypto.randomUUID()}@flowboard.example`);
      assert.equal(fallback.headers.get('location'), 'https://app.flowboard.example/projects');
    } finally {
      delete process.env['FRONTEND_URL'];
    }
  });
});
