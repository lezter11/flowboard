import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { closePool, getPool } from '../src/adapters/postgres.ts';
import { createApp } from '../src/http/app.ts';
import { adminSecretMatches, configuredAdminSecret } from '../src/http/admin-secret.ts';

const realFetch = globalThis.fetch;

function googleFetch(profile: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'synthetic' });
    if (url.includes('googleapis.com/oauth2/v3/userinfo')) return Response.json(profile);
    throw new Error(`unexpected outbound request: ${url}`);
  }) as typeof fetch;
}

test('Google sign-in and system routes', async (t) => {
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

  async function signIn(profile: Record<string, unknown>, stateOverride?: string) {
    const start = await app.request('http://localhost:8787/api/v1/auth/google');
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const stateCookie = start.headers.get('set-cookie')!.split(';')[0]!;
    globalThis.fetch = googleFetch(profile);
    return app.request(
      `http://localhost:8787/api/v1/auth/google/callback?code=abc&state=${stateOverride ?? state}`,
      { headers: { cookie: stateCookie } },
    );
  }

  await t.test('rejects an unverified Google email and issues no session', async () => {
    const res = await signIn({ sub: '1', email: 'unverified.user@flowboard.example', email_verified: false });
    assert.equal(res.status, 302, 'a failure redirects to sign-in');
    assert.match(res.headers.get('location') ?? '', /\/signin\?state=email_unverified$/);
    assert.equal(res.headers.get('set-cookie')?.includes('flowboard_session=') ?? false, false);
    const rows = await getPool().query(`SELECT 1 FROM users WHERE email = 'unverified.user@flowboard.example'`);
    assert.equal(rows.rowCount, 0);
  });

  await t.test('rejects a missing email_verified claim', async () => {
    const res = await signIn({ sub: '2', email: 'noclaim.user@flowboard.example' });
    assert.equal(res.status, 302, 'a failure redirects to sign-in');
    assert.match(res.headers.get('location') ?? '', /\/signin\?state=email_unverified$/);
  });

  await t.test('rejects a state that does not match the cookie', async () => {
    const res = await signIn({ sub: '3', email: 'csrf.user@flowboard.example', email_verified: true }, 'forged');
    assert.equal(res.status, 302, 'a failure redirects to sign-in');
    assert.match(res.headers.get('location') ?? '', /\/signin\?state=expired$/);
  });

  await t.test('a cookie with a valid next', async () => {
    const res = await signIn({ sub: '4', email: 'Verified.User@flowboard.example', email_verified: true, name: 'Verified User' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('set-cookie')!, /flowboard_session=/);
    assert.match(res.headers.get('set-cookie')!, /HttpOnly/i);
  });

  await t.test('preserves custom display_name on subsequent Google sign-in and updates avatar (R3-11)', async () => {
    // 1. First sign-in creates the user
    const res1 = await signIn({
      sub: '5',
      email: 'custom.profile@flowboard.example',
      email_verified: true,
      name: 'Initial Google Name',
      picture: 'https://example.com/old-avatar.png',
    });
    assert.equal(res1.status, 302);

    // 2. User updates their profile to a custom display name
    const pool = getPool();
    await pool.query(
      `UPDATE users SET display_name = 'Custom Preserved Name' WHERE email = 'custom.profile@flowboard.example'`,
    );

    // 3. Second sign-in with Google returns different name and updated picture
    const res2 = await signIn({
      sub: '5',
      email: 'custom.profile@flowboard.example',
      email_verified: true,
      name: 'Overwriting Attempt Name',
      picture: 'https://example.com/new-avatar.png',
    });
    assert.equal(res2.status, 302);

    // Verify user in DB still has custom display name and updated avatar
    const userRes = await pool.query<{ display_name: string; avatar_url: string | null }>(
      `SELECT display_name, avatar_url FROM users WHERE email = 'custom.profile@flowboard.example'`,
    );
    assert.equal(userRes.rows[0]?.display_name, 'Custom Preserved Name', 'Custom display name must be preserved');
    assert.equal(userRes.rows[0]?.avatar_url, 'https://example.com/new-avatar.png', 'Avatar URL must be updated when provided');
  });

  await t.test('admin secret has no public default outside tests and needs 32+ chars', () => {
    const env = process.env as Record<string, string | undefined>;
    const saved = { node: env['NODE_ENV'], secret: env['DEV_LOGIN_SECRET'] };
    try {
      env['NODE_ENV'] = 'production';
      delete env['DEV_LOGIN_SECRET'];
      assert.equal(configuredAdminSecret(), null);
      assert.equal(adminSecretMatches('flowboard-dev-secret'), false);
      env['DEV_LOGIN_SECRET'] = 'too-short';
      assert.equal(adminSecretMatches('too-short'), false);
      env['DEV_LOGIN_SECRET'] = 's'.repeat(32);
      assert.equal(adminSecretMatches('s'.repeat(32)), true);
      assert.equal(adminSecretMatches('s'.repeat(31)), false);
      assert.equal(adminSecretMatches(undefined), false);
    } finally {
      env['NODE_ENV'] = saved.node;
      if (saved.secret === undefined) delete env['DEV_LOGIN_SECRET']; else env['DEV_LOGIN_SECRET'] = saved.secret;
    }
  });

  await t.test('system migrate and status are closed without the secret', async () => {
    for (const [method, path] of [['POST', '/api/v1/system/migrate'], ['GET', '/api/v1/system/status']] as const) {
      const res = await app.request(path, { method });
      assert.equal(res.status, 403, path);
      const wrong = await app.request(path, { method, headers: { 'x-dev-secret': 'wrong' } });
      assert.equal(wrong.status, 403, path);
    }
  });
});
