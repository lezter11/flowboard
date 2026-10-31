import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession, createSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// B-16: first and last name. Migration 0018, Google suggestions, the session fields, the save route,
// display-name sync, hostile input, and the invitation accept gate. Google is mocked; nothing calls it.

const pool: pg.Pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 4);
setGlobalPool(pool);
const app = createApp(async () => {}, { pool });
const ORIGIN = 'http://localhost';
const realFetch = globalThis.fetch;
const migration0018 = fileURLToPath(new URL('../../../database/migrations/0018_user_names.sql', import.meta.url));

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

function suffix() {
  return crypto.randomBytes(4).toString('hex');
}

/** A user as Google sign-in leaves them: no confirmed name. Inserted directly, for the existing-user cases. */
async function unconfirmedUser(email: string, displayName = 'Google Name') {
  const id = `usr_${suffix()}`;
  await pool.query(
    `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at) VALUES ($1, $2, $3, NULL, NOW(), NOW())`,
    [id, email, displayName],
  );
  const session = await createSession(id, 24, pool);
  return { id, cookie: `flowboard_session=${session.id}` };
}

function patchName(cookie: string | null, body: unknown, origin: string | null = ORIGIN) {
  return app.request(`${ORIGIN}/api/v1/session/name`, {
    method: 'PATCH',
    headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}), 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function getSession(cookie: string) {
  return app.request(`${ORIGIN}/api/v1/session`, { headers: { cookie } });
}

async function nameRow(id: string) {
  const res = await pool.query<{ first_name: string | null; last_name: string | null; display_name: string; name_confirmed_at: Date | null }>(
    'SELECT first_name, last_name, display_name, name_confirmed_at FROM users WHERE id = $1',
    [id],
  );
  return res.rows[0]!;
}

test('B-16 migration 0018: adds the three columns, is idempotent, and enforces the length bounds', async () => {
  const sql = readFileSync(migration0018, 'utf8');
  await pool.query(sql);
  await pool.query(sql);
  const cols = await pool.query<{ column_name: string; is_nullable: string }>(
    `SELECT column_name, is_nullable FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'users'
       AND column_name IN ('first_name', 'last_name', 'name_confirmed_at') ORDER BY column_name`,
  );
  assert.deepEqual(cols.rows.map((r) => r.column_name), ['first_name', 'last_name', 'name_confirmed_at']);
  assert.ok(cols.rows.every((r) => r.is_nullable === 'YES'), 'the new columns are nullable');

  const id = `usr_${suffix()}`;
  await pool.query(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES ($1, $2, 'N', NOW(), NOW())`, [id, `m.${id}@flowboard.example`]);
  await assert.rejects(
    pool.query(`UPDATE users SET first_name = $2 WHERE id = $1`, [id, 'x'.repeat(61)]),
    (err: any) => err.code === '23514' && err.constraint === 'users_first_name_length',
  );
  await pool.query(`UPDATE users SET first_name = $2 WHERE id = $1`, [id, 'x'.repeat(60)]);
});

test('B-16 Google sign-in: given and family name are suggestions only, and the name stays unconfirmed', async (t) => {
  const email = `suggest.${suffix()}@flowboard.example`;
  const signIn = async (profile: Record<string, unknown>) => {
    const start = await app.request('http://localhost:8787/api/v1/auth/google');
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const stateCookie = start.headers.get('set-cookie')!.split(';')[0]!;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'synthetic' });
      if (url.includes('googleapis.com/oauth2/v3/userinfo')) return Response.json(profile);
      throw new Error(`unexpected outbound request: ${url}`);
    }) as typeof fetch;
    const res = await app.request(`http://localhost:8787/api/v1/auth/google/callback?code=abc&state=${state}`, { headers: { cookie: stateCookie } });
    globalThis.fetch = realFetch;
    assert.equal(res.status, 302);
    const sessionCookie = res.headers.getSetCookie().find((h) => h.startsWith('flowboard_session='));
    assert.ok(sessionCookie, 'the callback sets the session cookie');
    return sessionCookie.split(';')[0]!;
  };

  const cookie = await signIn({ sub: 'g1', email, email_verified: true, name: 'Asha Rao', given_name: 'Asha', family_name: 'Rao' });
  const first = (await (await getSession(cookie)).json() as any).data;
  assert.equal(first.needsName, true, 'a Google user has not confirmed a name');
  assert.equal(first.suggestedFirstName, 'Asha');
  assert.equal(first.suggestedLastName, 'Rao');
  assert.equal(first.actor.displayName, 'Asha Rao', 'display name still comes from the Google name');

  await t.test('a second sign-in refreshes the suggestion while the name is unconfirmed', async () => {
    const again = await signIn({ sub: 'g1', email, email_verified: true, name: 'Asha Rao', given_name: 'Ash', family_name: 'Rao-Patel' });
    const data = (await (await getSession(again)).json() as any).data;
    assert.equal(data.needsName, true);
    assert.equal(data.suggestedFirstName, 'Ash');
    assert.equal(data.suggestedLastName, 'Rao-Patel');
  });

  await t.test('a profile with no given or family name gives no suggestion, and sign-in still works', async () => {
    const bare = `bare.${suffix()}@flowboard.example`;
    const c = await signIn({ sub: 'g2', email: bare, email_verified: true, name: 'Single' });
    const data = (await (await getSession(c)).json() as any).data;
    assert.equal(data.needsName, true);
    assert.equal(data.suggestedFirstName, null);
    assert.equal(data.suggestedLastName, null);
  });

  await t.test('after the user saves a name, a later sign-in changes neither the names nor the confirmation', async () => {
    const saved = await patchName(cookie, { firstName: 'Asha', lastName: 'Rao' });
    assert.equal(saved.status, 200, await saved.clone().text());
    const uid = (await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email])).rows[0]!.id;
    const before = await nameRow(uid);
    const later = await signIn({ sub: 'g1', email, email_verified: true, name: 'Asha Rao', given_name: 'Different', family_name: 'Person' });
    const data = (await (await getSession(later)).json() as any).data;
    assert.equal(data.needsName, false);
    assert.equal(data.suggestedFirstName, null);
    assert.equal(data.suggestedLastName, null);
    const after = await nameRow(uid);
    assert.equal(after.first_name, 'Asha');
    assert.equal(after.last_name, 'Rao');
    assert.equal(after.name_confirmed_at?.getTime(), before.name_confirmed_at?.getTime(), 'the confirmation time is kept');
  });
});

test('B-16 session: an existing or Google user is asked for a name; a dev fixture user is not', async () => {
  const existing = await unconfirmedUser(`existing.${suffix()}@flowboard.example`, 'Old Name');
  const data = (await (await getSession(existing.cookie)).json() as any).data;
  assert.equal(data.needsName, true, 'an existing user without a confirmed name is asked, once');
  assert.equal(data.suggestedFirstName, null, 'no suggestion without a Google sign-in');

  const dev = await createDevUserAndSession(`dev.${suffix()}@flowboard.example`, 'Olive Owner', pool);
  const devData = (await (await getSession(`flowboard_session=${dev.session.id}`)).json() as any).data;
  assert.equal(devData.needsName, false, 'a local fixture user counts as named');
  assert.equal(devData.suggestedFirstName, null);
});

test('B-16 save: names are trimmed and collapsed, display_name follows, and saving again is idempotent', async () => {
  const user = await unconfirmedUser(`save.${suffix()}@flowboard.example`);
  const res = await patchName(user.cookie, { firstName: '  Ada   Marie ', lastName: '\tLovelace  ' });
  assert.equal(res.status, 200, await res.clone().text());
  const body = (await res.json() as any).data;
  assert.equal(body.firstName, 'Ada Marie');
  assert.equal(body.lastName, 'Lovelace');
  assert.equal(body.needsName, false);
  assert.equal(body.actor.displayName, 'Ada Marie Lovelace');

  const first = await nameRow(user.id);
  assert.equal(first.display_name, 'Ada Marie Lovelace', 'display_name is kept in sync');
  assert.ok(first.name_confirmed_at instanceof Date, 'the confirmation time is set');

  const again = await patchName(user.cookie, { firstName: 'Ada', lastName: 'Lovelace' });
  assert.equal(again.status, 200);
  const second = await nameRow(user.id);
  assert.equal(second.first_name, 'Ada');
  assert.equal(second.display_name, 'Ada Lovelace');
  assert.equal(second.name_confirmed_at?.getTime(), first.name_confirmed_at?.getTime(), 'the first confirmation time is kept');
  const session = (await (await getSession(user.cookie)).json() as any).data;
  assert.equal(session.needsName, false);
});

test('B-16 hostile input: refused with 422 and nothing stored; plain text is kept as text', async (t) => {
  const user = await unconfirmedUser(`hostile.${suffix()}@flowboard.example`);
  await patchName(user.cookie, { firstName: 'Keep', lastName: 'Me' });
  const before = await nameRow(user.id);

  const refused: Array<[string, unknown]> = [
    ['NUL control', { firstName: 'Ash\u0000a', lastName: 'Rao' }],
    ['zero-width space', { firstName: 'Ash​ley', lastName: 'Rao' }],
    ['zero-width joiner', { firstName: 'Ash‍ley', lastName: 'Rao' }],
    ['BOM', { firstName: '﻿Asha', lastName: 'Rao' }],
    ['right-to-left override', { firstName: 'Ash‮ley', lastName: 'Rao' }],
    ['left-to-right isolate', { firstName: 'Ash⁦ley', lastName: 'Rao' }],
    ['line separator', { firstName: 'Ash ley', lastName: 'Rao' }],
    ['paragraph separator', { firstName: 'Asha', lastName: 'Rao ' }],
    ['CRLF injection', { firstName: 'Asha\r\nBcc: x@example.net', lastName: 'Rao' }],
    ['too long (61)', { firstName: 'x'.repeat(61), lastName: 'Rao' }],
    ['whitespace only', { firstName: '   ', lastName: 'Rao' }],
    ['empty last name', { firstName: 'Asha', lastName: '' }],
    ['missing last name', { firstName: 'Asha' }],
    ['number', { firstName: 42, lastName: 'Rao' }],
    ['unknown field', { firstName: 'Asha', lastName: 'Rao', role: 'owner' }],
  ];
  for (const [label, body] of refused) {
    await t.test(label, async () => {
      const res = await patchName(user.cookie, body);
      assert.equal(res.status, 422, `${label}: ${await res.clone().text()}`);
    });
  }
  const after = await nameRow(user.id);
  assert.equal(after.first_name, before.first_name, 'no refused value was stored');
  assert.equal(after.last_name, before.last_name);
  assert.equal(after.display_name, before.display_name);

  const html = await patchName(user.cookie, { firstName: '<b>Ada</b>', lastName: "O'Neil & Co" });
  assert.equal(html.status, 200);
  const stored = await nameRow(user.id);
  assert.equal(stored.first_name, '<b>Ada</b>', 'stored as plain text');
  assert.equal(stored.last_name, "O'Neil & Co");
});

test('B-16 authorization: the save needs a signed-in session and a same-site Origin', async () => {
  const user = await unconfirmedUser(`authz.${suffix()}@flowboard.example`);
  const anon = await patchName(null, { firstName: 'A', lastName: 'B' });
  assert.equal(anon.status, 401);
  const foreign = await patchName(user.cookie, { firstName: 'A', lastName: 'B' }, 'https://evil.example');
  assert.equal(foreign.status, 403, 'a cross-site write is refused');
  assert.equal((await nameRow(user.id)).name_confirmed_at, null, 'nothing changed');
});

test('B-16 accept gate: an unnamed user cannot accept an invitation; a named user can', async () => {
  const owner = await createDevUserAndSession(`owner.${suffix()}@flowboard.example`, 'Olive Owner', pool);
  const ws = `ws_${suffix()}`;
  const project = `p_${suffix()}`;
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`, [ws, owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'Gate',now(),now())`, [project, ws]);

  const inviteeEmail = `gate.${suffix()}@flowboard.example`;
  const invitee = await unconfirmedUser(inviteeEmail);
  const invited = await app.request(`${ORIGIN}/api/v1/projects/${project}/invitations`, {
    method: 'POST',
    headers: { cookie: `flowboard_session=${owner.session.id}`, origin: ORIGIN, 'idempotency-key': `b16-${crypto.randomUUID()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: inviteeEmail, role: 'member' }),
  });
  assert.equal(invited.status, 201, await invited.clone().text());
  const token = ((await invited.json()) as any).data.token as string;

  const accept = (cookie: string) =>
    app.request(`${ORIGIN}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: { cookie, origin: ORIGIN, 'idempotency-key': `b16-acc-${crypto.randomUUID()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });

  const blocked = await accept(invitee.cookie);
  assert.equal(blocked.status, 409, await blocked.clone().text());
  const shape = (await blocked.json()) as any;
  assert.equal(shape.error.code, 'NAME_REQUIRED', 'the refusal names the reason');
  assert.equal(typeof shape.error.message, 'string');

  const named = await patchName(invitee.cookie, { firstName: 'Gate', lastName: 'Guest' });
  assert.equal(named.status, 200);
  const accepted = await accept(invitee.cookie);
  assert.ok(accepted.status < 300, `after naming, accept succeeds: ${accepted.status} ${await accepted.clone().text()}`);
  const membership = await pool.query(`SELECT 1 FROM project_memberships WHERE project_id = $1 AND user_id = $2`, [project, invitee.id]);
  assert.equal(membership.rowCount, 1);
});
