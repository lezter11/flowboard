import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// B-9 profile edit: a user changes their own display name. Email and avatar stay Google-owned.

const pool: pg.Pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 4);
setGlobalPool(pool);
const app = createApp(async () => {}, { pool });

async function fixture() {
  await runMigrations(pool);
  const s = crypto.randomBytes(4).toString('hex');
  const owner = await createDevUserAndSession(`owner.${s}@flowboard.example`, 'Owner', pool);
  const viewer = await createDevUserAndSession(`viewer.${s}@flowboard.example`, 'Viewer', pool);
  const ws = `ws_${s}`;
  const project = `p_${s}`;
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`, [ws, owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'P',now(),now())`, [project, ws]);
  await pool.query(
    `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
     VALUES ($1,$2,$3,$4,'viewer','active',1,now(),now())`,
    [`pm_${s}`, project, ws, viewer.user.id],
  );
  return { s, project, owner, viewer, email: `viewer.${s}@flowboard.example` };
}

function patch(cookie: string | null, body: unknown) {
  return app.request('http://localhost/api/v1/session/profile', {
    method: 'PATCH',
    headers: { ...(cookie ? { cookie } : {}), origin: 'http://localhost', 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

test('B-9 profile: the display name changes, is trimmed, and shows everywhere it is read', async (t) => {
  const fx = await fixture();
  const cookie = `flowboard_session=${fx.viewer.session.id}`;

  await t.test('a valid name is saved trimmed and returned', async () => {
    const res = await patch(cookie, { displayName: '  Vee Renamed  ' });
    assert.equal(res.status, 200, await res.clone().text());
    const body = (await res.json()) as any;
    assert.equal(body.data.displayName, 'Vee Renamed');
  });

  await t.test('the session read shows the new name', async () => {
    const res = await app.request('http://localhost/api/v1/session', { headers: { cookie } });
    assert.equal(((await res.json()) as any).data.actor.displayName, 'Vee Renamed');
  });

  await t.test('the project people list shows the new name to another member', async () => {
    const res = await app.request(`http://localhost/api/v1/projects/${fx.project}/people`, {
      headers: { cookie: `flowboard_session=${fx.owner.session.id}` },
    });
    assert.equal(res.status, 200, await res.clone().text());
    const names = ((await res.json()) as any).data.map((p: any) => p.displayName);
    assert.ok(names.includes('Vee Renamed'));
    assert.ok(!names.includes('Viewer'));
  });

  await t.test('a name of exactly 80 characters is accepted, 81 is refused', async () => {
    assert.equal((await patch(cookie, { displayName: 'a'.repeat(80) })).status, 200);
    const tooLong = await patch(cookie, { displayName: 'a'.repeat(81) });
    assert.equal(tooLong.status, 422);
    assert.equal(((await tooLong.json()) as any).error.code, 'VALIDATION_ERROR');
  });

  await t.test('empty, whitespace-only and non-string names are refused', async () => {
    for (const bad of ['', '   ', 42, null]) {
      assert.equal((await patch(cookie, { displayName: bad })).status, 422, JSON.stringify(bad));
    }
  });

  await t.test('control characters are refused, including a trailing newline that trim would hide', async () => {
    for (const bad of ['Vee\u0007', 'Vee\nBcc', 'Vee\r\n', 'Vee\tTab', 'Vee\u007f']) {
      assert.equal((await patch(cookie, { displayName: bad })).status, 422, JSON.stringify(bad));
    }
  });

  await t.test('avatarUrl and any other field are refused: the avatar is Google-owned', async () => {
    const avatar = await patch(cookie, { displayName: 'Vee', avatarUrl: 'https://example.com/a.png' });
    assert.equal(avatar.status, 422);
    const extra = await patch(cookie, { displayName: 'Vee', email: 'someone@example.com' });
    assert.equal(extra.status, 422);
  });

  await t.test('no session is refused with 401 and nothing changes', async () => {
    const before = await pool.query<{ display_name: string }>('SELECT display_name FROM users WHERE id = $1', [fx.viewer.user.id]);
    assert.equal((await patch(null, { displayName: 'Intruder' })).status, 401);
    const after = await pool.query<{ display_name: string }>('SELECT display_name FROM users WHERE id = $1', [fx.viewer.user.id]);
    assert.equal(after.rows[0]!.display_name, before.rows[0]!.display_name);
  });

  await t.test('refused edits leave the stored name unchanged', async () => {
    await patch(cookie, { displayName: 'Vee\u0007' });
    const row = await pool.query<{ display_name: string }>('SELECT display_name FROM users WHERE id = $1', [fx.viewer.user.id]);
    assert.equal(row.rows[0]!.display_name, 'a'.repeat(80));
  });
});

test('B-9 profile: a Google sign-in keeps an edited name and refreshes only Google-owned fields', async () => {
  const fx = await fixture();
  await patch(`flowboard_session=${fx.viewer.session.id}`, { displayName: 'Edited Name' });

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
      return new Response(JSON.stringify({
        email: fx.email,
        email_verified: true,
        name: 'Google Given Name',
        picture: 'https://lh3.example.com/new-photo.png',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  try {
    const res = await app.request(
      'http://localhost/api/v1/auth/google/callback?code=abc&state=st_b9',
      { headers: { cookie: 'flowboard_oauth_state=st_b9' } },
      { GOOGLE_CLIENT_ID: 'client-id-b9', GOOGLE_CLIENT_SECRET: 'client-secret-b9' } as never,
    );
    assert.ok(res.status < 400, `sign-in succeeds, got ${res.status}`);
  } finally {
    globalThis.fetch = realFetch;
  }

  const row = await pool.query<{ display_name: string; avatar_url: string | null }>(
    'SELECT display_name, avatar_url FROM users WHERE id = $1',
    [fx.viewer.user.id],
  );
  assert.equal(row.rows[0]!.display_name, 'Edited Name', 'the edited name survives sign-in');
  assert.equal(row.rows[0]!.avatar_url, 'https://lh3.example.com/new-photo.png', 'the Google avatar still refreshes');
});
