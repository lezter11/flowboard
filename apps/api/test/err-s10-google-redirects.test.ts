import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { after, before } from 'node:test';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { closePool, getPool } from '../src/adapters/postgres.ts';

// ERR-R1 S10: a failed Google sign-in is a 302 to the sign-in page with a state value, never a JSON error on a
// top-level navigation. The provider's own error text is never reflected, and no failure reaches the browser as JSON.

const realFetch = globalThis.fetch;
const app = createApp();

before(async () => {
  process.env['GOOGLE_CLIENT_ID'] = 'synthetic-client';
  process.env['GOOGLE_CLIENT_SECRET'] = 'synthetic-secret';
  await runMigrations(getPool());
});
after(async () => {
  globalThis.fetch = realFetch;
  delete process.env['GOOGLE_CLIENT_ID'];
  delete process.env['GOOGLE_CLIENT_SECRET'];
  await closePool();
});

/** Starts sign-in, then calls the callback. `provider` answers the outbound token and userinfo calls. */
async function callback(
  query: (state: string) => string,
  provider: ((url: string) => Response | Promise<Response>) | null,
) {
  const start = await app.request('http://localhost:8787/api/v1/auth/google');
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const stateCookie = start.headers.get('set-cookie')!.split(';')[0]!;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!provider) throw new Error(`unexpected outbound request: ${url}`);
    return provider(url);
  }) as typeof fetch;
  try {
    return await app.request(`http://localhost:8787/api/v1/auth/google/callback?${query(state)}`, { headers: { cookie: stateCookie } });
  } finally {
    globalThis.fetch = realFetch;
  }
}

const tokenOk = (url: string) => (url.includes('oauth2.googleapis.com/token') ? Response.json({ access_token: 'synthetic' }) : null);

function expectRedirect(res: Response, state: string) {
  assert.equal(res.status, 302, `302 for ${state}`);
  const location = res.headers.get('location') ?? '';
  assert.match(location, new RegExp(`/signin\\?state=${state}$`), `location for ${state}: ${location}`);
  assert.equal((res.headers.get('content-type') ?? '').includes('application/json'), false, 'never JSON on a navigation');
}

test('ERR-R1 S10: the provider denial redirects with state=denied, and its text is never reflected', async () => {
  const hostile = '<script>alert(1)</script>';
  const res = await callback((state) => `error=${encodeURIComponent(hostile)}&state=${state}`, null);
  expectRedirect(res, 'denied');
  const location = res.headers.get('location') ?? '';
  assert.equal(location.includes('script'), false, 'the provider error text is not reflected');
  assert.equal(location.includes('alert'), false);
});

test('ERR-R1 S10: a state that does not match the cookie redirects with state=expired', async () => {
  const res = await callback(() => `code=abc&state=forged`, null);
  expectRedirect(res, 'expired');
});

test('ERR-R1 S10: a missing code or state redirects with state=failed', async () => {
  const res = await callback(() => 'state=', null);
  expectRedirect(res, 'failed');
});

test('ERR-R1 S10: a network failure while exchanging the code redirects with state=failed, not a 500 JSON', async () => {
  const res = await callback((state) => `code=abc&state=${state}`, () => {
    throw new TypeError('fetch failed');
  });
  expectRedirect(res, 'failed');
});

test('ERR-R1 S10: a profile with no email redirects with state=email_missing', async () => {
  const res = await callback((state) => `code=abc&state=${state}`, (url) =>
    tokenOk(url) ?? Response.json({ sub: 'x', email_verified: true }),
  );
  expectRedirect(res, 'email_missing');
});

test('ERR-R1 S10: an unverified email redirects with state=email_unverified and issues no session', async () => {
  const email = `unverified.${crypto.randomUUID()}@flowboard.example`;
  const res = await callback((state) => `code=abc&state=${state}`, (url) =>
    tokenOk(url) ?? Response.json({ sub: 'y', email, email_verified: false }),
  );
  expectRedirect(res, 'email_unverified');
  assert.equal(res.headers.get('set-cookie')?.includes('flowboard_session=') ?? false, false);
});
