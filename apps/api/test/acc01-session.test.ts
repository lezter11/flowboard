import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createSession } from '../src/adapters/session.ts';
import { getSessionResponseSchema } from '@flowboard/contracts';

test('ACC-01: Sign in, Sessions and Authentication Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query('TRUNCATE workspaces, users, sessions CASCADE;');
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  let aliceCookie = '';
  let aliceSessionId = '';
  let aliceUserId = '';

  await t.test('1. POST /api/v1/session/dev-login creates user, session, and sets cookie', async () => {
    const res = await app.request('/api/v1/session/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@flowboard.example',
        displayName: 'Alice Owner',
      }),
    });

    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'Expected Set-Cookie header');
    assert.match(setCookie, /flowboard_session=[a-f0-9]{64};/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//);

    // Extract cookie value for subsequent requests
    const cookieMatch = setCookie.match(/flowboard_session=([a-f0-9]{64})/);
    assert.ok(cookieMatch && cookieMatch[1]);
    aliceSessionId = cookieMatch[1];
    aliceCookie = `flowboard_session=${aliceSessionId}`;

    const body = await res.json();
    assert.equal(body.data.actor.email, 'alice@flowboard.example');
    assert.equal(body.data.actor.displayName, 'Alice Owner');
    assert.equal(body.data.session.id, aliceSessionId);
    aliceUserId = body.data.actor.id;

    // Verify session exists in DB
    const client = await pool.connect();
    try {
      const q = await client.query('SELECT * FROM sessions WHERE id = $1', [aliceSessionId]);
      assert.equal(q.rows.length, 1);
      assert.equal(q.rows[0].user_id, aliceUserId);
    } finally {
      client.release();
    }
  });

  await t.test('2. GET /api/v1/session with valid cookie returns actor, owned workspaces, and accessible projects', async () => {
    // Seed a workspace and projects for Alice
    const client = await pool.connect();
    const now = new Date().toISOString();
    try {
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        ['ws_alice_corp', 'Alice Corp', 'America/New_York', aliceUserId, 1, now, now],
      );

      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8),
                ($9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          'prj_alpha', 'ws_alice_corp', 'Project Alpha', 'Alpha description', false, 1, now, now,
          'prj_beta', 'ws_alice_corp', 'Project Beta', null, false, 1, now, now,
        ],
      );
    } finally {
      client.release();
    }

    const res = await app.request('/api/v1/session', {
      headers: { Cookie: aliceCookie },
    });

    assert.equal(res.status, 200);
    const body = await res.json();

    // Validate with shared contracts schema
    const parseResult = getSessionResponseSchema.safeParse(body);
    assert.equal(parseResult.success, true, 'Response must match getSessionResponseSchema');

    assert.equal(body.data.actor.id, aliceUserId);
    assert.equal(body.data.actor.email, 'alice@flowboard.example');
    assert.equal(body.data.ownedWorkspaces.length, 1);
    assert.equal(body.data.ownedWorkspaces[0].id, 'ws_alice_corp');
    assert.equal(body.data.ownedWorkspaces[0].name, 'Alice Corp');

    assert.equal(body.data.accessibleProjects.length, 2);
    const prjIds = body.data.accessibleProjects.map((p: any) => p.id);
    assert.ok(prjIds.includes('prj_alpha'));
    assert.ok(prjIds.includes('prj_beta'));

    // Workspace owner inherits 'owner' role across all projects
    for (const p of body.data.accessibleProjects) {
      assert.equal(p.role, 'owner');
      assert.equal(p.isArchived, false);
    }
  });

  await t.test('3. GET /api/v1/session without cookie returns 401 UNAUTHORIZED', async () => {
    const res = await app.request('/api/v1/session');
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
    assert.ok(body.error.requestId);
  });

  await t.test('4. GET /api/v1/session with expired session returns 401 UNAUTHORIZED', async () => {
    // Create session that expired 2 hours ago
    const expiredSession = await createSession(aliceUserId, -2, pool);

    const res = await app.request('/api/v1/session', {
      headers: { Cookie: `flowboard_session=${expiredSession.id}` },
    });

    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.error.code, 'UNAUTHORIZED');
    assert.ok(body.error.requestId);
  });

  await t.test('5. POST /api/v1/session/logout revokes session in DB and clears cookie (204 No Content)', async () => {
    const res = await app.request('/api/v1/session/logout', {
      method: 'POST',
      headers: { Cookie: aliceCookie },
    });

    assert.equal(res.status, 204);
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie, 'Expected Set-Cookie header on logout');
    assert.match(setCookie, /flowboard_session=;/);
    assert.match(setCookie, /Max-Age=0/);

    const bodyText = await res.text();
    assert.equal(bodyText, '', 'Logout response body must be empty for 204 No Content');

    // Verify session is revoked from DB
    const client = await pool.connect();
    try {
      const q = await client.query('SELECT * FROM sessions WHERE id = $1', [aliceSessionId]);
      assert.equal(q.rows.length, 0);
    } finally {
      client.release();
    }

    // Subsequent call with the revoked session returns 401
    const recheck = await app.request('/api/v1/session', {
      headers: { Cookie: aliceCookie },
    });
    assert.equal(recheck.status, 401);
  });

  await t.test('6. POST /api/v1/session/dev-login rejects existing user without X-Dev-Secret (403 FORBIDDEN)', async () => {
    // Alice already exists in the users table
    const res = await app.request('/api/v1/session/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@flowboard.example',
      }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.equal(body.error.message, 'Cannot sign in to existing account without development secret.');
    assert.ok(body.error.requestId);
  });

  await t.test('7. POST /api/v1/session/dev-login rejects existing user with invalid X-Dev-Secret (403 FORBIDDEN)', async () => {
    const res = await app.request('/api/v1/session/dev-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-Secret': 'invalid-secret-value',
      },
      body: JSON.stringify({
        email: 'alice@flowboard.example',
      }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error.code, 'FORBIDDEN');
    assert.equal(body.error.message, 'Cannot sign in to existing account without development secret.');
    assert.ok(body.error.requestId);
  });

  await t.test('8. POST /api/v1/session/dev-login succeeds for existing user with valid X-Dev-Secret', async () => {
    const validSecret = process.env.DEV_LOGIN_SECRET || 'flowboard-dev-secret';
    const res = await app.request('/api/v1/session/dev-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-Secret': validSecret,
      },
      body: JSON.stringify({
        email: 'alice@flowboard.example',
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.actor.id, aliceUserId);
    assert.equal(body.data.actor.email, 'alice@flowboard.example');
    assert.ok(body.data.session.id);
  });

  await t.test('9. POST /api/v1/session/dev-login returns 404 NOT_FOUND when NODE_ENV === "production"', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const res = await app.request('/api/v1/session/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'brandnew@flowboard.example',
        }),
      });

      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error.code, 'NOT_FOUND');
      assert.equal(body.error.message, 'Route not found.');
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  await t.test('10. Cookies have Secure flag when request is not from localhost', async () => {
    const res = await app.request('https://flowboard.example.com/api/v1/session/dev-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: 'flowboard.example.com',
      },
      body: JSON.stringify({
        email: 'remote.user@flowboard.example',
      }),
    });

    assert.equal(res.status, 200);
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie);
    assert.match(setCookie, /Secure/i, 'Cookie must include Secure flag when not on localhost');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /Path=\//);
  });
});
