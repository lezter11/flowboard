import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { after, before } from 'node:test';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createSession } from '../src/adapters/session.ts';
import { ensurePersonalWorkspace, PERSONAL_WORKSPACE_NAME } from '../src/adapters/personal-workspace.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// B-17: one personal workspace per person, made by one helper. Parallel callers, a double Google
// sign-in, a long display name, and the deterministic primary. Nothing calls Google: fetch is mocked.

const pool: pg.Pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 8);
setGlobalPool(pool);
const app = createApp(async () => {}, { pool });
const realFetch = globalThis.fetch;

before(async () => {
  process.env['GOOGLE_CLIENT_ID'] = 'synthetic-client';
  process.env['GOOGLE_CLIENT_SECRET'] = 'synthetic-secret';
  await runMigrations(pool);
});
after(async () => {
  globalThis.fetch = realFetch;
  delete process.env['GOOGLE_CLIENT_ID'];
  delete process.env['GOOGLE_CLIENT_SECRET'];
  await pool.end();
});

async function bareUser(displayName: string) {
  const id = `usr_${crypto.randomBytes(8).toString('hex')}`;
  await pool.query(
    `INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
    [id, `b17.${id}@flowboard.example`, displayName],
  );
  return id;
}

async function ownedWorkspaces(userId: string) {
  const res = await pool.query<{ id: string; name: string }>('SELECT id, name FROM workspaces WHERE owner_id = $1 ORDER BY created_at, id', [userId]);
  return res.rows;
}

test('B-17 ensure: parallel callers for a person with no workspace make exactly one', async () => {
  const userId = await bareUser('Parallel Person');
  const attempt = async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = await ensurePersonalWorkspace(client, userId);
      await client.query('COMMIT');
      return id;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  };
  const ids = await Promise.all(Array.from({ length: 8 }, () => attempt()));
  assert.equal(new Set(ids).size, 1, 'every caller gets the same workspace id');
  const rows = await ownedWorkspaces(userId);
  assert.equal(rows.length, 1, 'one workspace row');
  assert.equal(rows[0]!.name, PERSONAL_WORKSPACE_NAME, 'the fixed internal name, never the person name');
});

test('B-17 ensure: the primary workspace is the oldest owned one, by created_at then id', async () => {
  const userId = await bareUser('Two Workspaces');
  await pool.query(`INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at) VALUES ('ws_newer_${userId}', 'Newer', 'UTC', $1, 1, '2026-06-02T00:00:00Z', NOW())`, [userId]);
  await pool.query(`INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at) VALUES ('ws_older_${userId}', 'Older', 'UTC', $1, 1, '2026-06-01T00:00:00Z', NOW())`, [userId]);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    assert.equal(await ensurePersonalWorkspace(client, userId), `ws_older_${userId}`);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
});

test('B-17 sign-in: a long display name never makes a workspace the session cannot parse', async () => {
  const longName = 'Maximilian Alexander Bartholomew Crandall-Winterbottom Fitzgerald Montgomery Vanderbilt-Smythe';
  const userId = await bareUser(longName.slice(0, 121));
  const session = await createSession(userId, 24, pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensurePersonalWorkspace(client, userId);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  const res = await app.request('http://localhost/api/v1/session', { headers: { cookie: `flowboard_session=${session.id}` } });
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json() as any).data;
  assert.equal(body.ownedWorkspaces.length, 1);
  assert.equal(body.ownedWorkspaces[0].name, PERSONAL_WORKSPACE_NAME);
});

test('B-17 double Google sign-in: the callback twice gives the person one workspace', async () => {
  const email = `google.${crypto.randomBytes(4).toString('hex')}@flowboard.example`;
  const signIn = async () => {
    const start = await app.request('http://localhost:8787/api/v1/auth/google');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const stateCookie = start.headers.get('set-cookie')!.split(';')[0]!;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'synthetic' });
      if (url.includes('googleapis.com/oauth2/v3/userinfo')) return Response.json({ sub: 'g-b17', email, email_verified: true, name: 'Double Callback' });
      throw new Error(`unexpected outbound request: ${url}`);
    }) as typeof fetch;
    const res = await app.request(`http://localhost:8787/api/v1/auth/google/callback?code=abc&state=${state}`, { headers: { cookie: stateCookie } });
    globalThis.fetch = realFetch;
    assert.equal(res.status, 302);
  };
  await Promise.all([signIn(), signIn()]);
  await signIn();
  const user = (await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0]!;
  assert.equal((await ownedWorkspaces(user.id)).length, 1, 'three sign-ins, one workspace');
});
