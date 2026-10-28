// Independent delta-review probes (BOARD-ACCESS-DELTA-20261028, round 1).
// Runs only against the disposable local access-test database in a fresh schema.
// Usage: FLOWBOARD_ACCESS_TEST_DATABASE_URL=... NODE_ENV=test node docs/reviews/BOARD-ACCESS-DELTA-20261028/reviewer-probes.ts
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { processOutboxLease } from '../../../apps/api/src/adapters/notifications.ts';
import { EMBEDDED_MIGRATIONS } from '../../../apps/api/src/adapters/embedded-migrations.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
assert.ok(testUrl, 'FLOWBOARD_ACCESS_TEST_DATABASE_URL must be set');
const u = new URL(testUrl);
assert.equal(u.hostname, '127.0.0.1');
assert.equal(u.port, '55492');
assert.equal(u.pathname, '/flowboard_access_test');
assert.equal(process.env['NODE_ENV'], 'test', 'run with NODE_ENV=test (switched per probe)');
process.env['CURSOR_SECRET'] ??= 'delta_review_synthetic_cursor_key_not_for_production_0001';

let failures = 0;
const results: string[] = [];
function check(id: string, ok: boolean, detail: string) {
  const line = `${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`;
  results.push(line);
  console.log(line);
  if (!ok) failures++;
}
function note(id: string, detail: string) {
  const line = `NOTE ${id}: ${detail}`;
  results.push(line);
  console.log(line);
}

const schema = `delta_r1_${crypto.randomUUID().replaceAll('-', '')}`;
const legacySchema = `delta_r1_legacy_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: testUrl, max: 2 });
await admin.query(`CREATE SCHEMA "${schema}"`);
await admin.query(`CREATE SCHEMA "${legacySchema}"`);
const pool = new pg.Pool({ connectionString: testUrl, max: 12, options: `-c search_path=${schema}` });
const legacyPool = new pg.Pool({ connectionString: testUrl, max: 4, options: `-c search_path=${legacySchema}` });
const realFetch = globalThis.fetch;

try {
  await runMigrations(pool);
  const app = createApp(async () => {}, { pool, deadlineMs: 30_000 });

  const req = (method: string, p: string, session?: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(`http://localhost/api/v1${p}`, {
      method,
      headers: {
        ...(session ? { cookie: `flowboard_session=${session}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) ? { 'Idempotency-Key': `delta-${crypto.randomUUID()}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  // =====================================================================
  // A. Embedded migrations vs SQL files
  // =====================================================================
  {
    const dir = path.resolve(import.meta.dirname, '../../../database/migrations');
    const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
    const same = files.length === EMBEDDED_MIGRATIONS.length && files.every((f, i) => {
      const e = EMBEDDED_MIGRATIONS[i]!;
      return e.name === f && e.version === f.split('_')[0] && e.sql === fs.readFileSync(path.join(dir, f), 'utf8');
    });
    check('A1-embedded-migrations-byte-identical', same, `${files.length} SQL files vs ${EMBEDDED_MIGRATIONS.length} embedded entries`);
    // Apply via embedded path (nonexistent dir forces EMBEDDED_MIGRATIONS) to a fresh schema and compare catalog.
    const embSchema = `delta_r1_emb_${crypto.randomUUID().replaceAll('-', '')}`;
    await admin.query(`CREATE SCHEMA "${embSchema}"`);
    const embPool = new pg.Pool({ connectionString: testUrl, max: 2, options: `-c search_path=${embSchema}` });
    try {
      await runMigrations(embPool, { migrationsDir: path.join(os.tmpdir(), `no-such-dir-${crypto.randomUUID()}`) });
      const cat = async (s: string) => (await admin.query(
        `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_schema = $1 ORDER BY table_name, column_name`, [s])).rows.map((r) => JSON.stringify(r)).join('\n');
      const idx = async (s: string) => (await admin.query(
        `SELECT indexname, replace(indexdef, $1, 'S') d FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`, [s])).rows.map((r) => `${r.indexname}:${r.d}`).join('\n');
      const trg = async (s: string) => (await admin.query(
        `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE n.nspname=$1 AND NOT t.tgisinternal ORDER BY 1`, [s])).rows.map((r) => r.tgname).join(',');
      check('A2-embedded-catalog-equal', (await cat(embSchema)) === (await cat(schema)) && (await idx(embSchema)) === (await idx(schema)) && (await trg(embSchema)) === (await trg(schema)),
        'columns, indexes and triggers equal between filesystem-applied and embedded-applied schemas');
    } finally {
      await embPool.end();
      await admin.query(`DROP SCHEMA "${embSchema}" CASCADE`);
    }
  }

  // =====================================================================
  // B. Google OAuth callback
  // =====================================================================
  process.env['GOOGLE_CLIENT_ID'] = 'synthetic-client';
  process.env['GOOGLE_CLIENT_SECRET'] = 'synthetic-secret';
  let outbound: string[] = [];
  const googleFetch = (profile: Record<string, unknown> | null, tokenOk = true): typeof fetch =>
    (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      outbound.push(url);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return tokenOk ? Response.json({ access_token: 'synthetic' }) : new Response('bad', { status: 400 });
      }
      if (url.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
        return profile ? Response.json(profile) : new Response('no', { status: 401 });
      }
      throw new Error(`unexpected outbound request ${url}`);
    }) as typeof fetch;

  async function startGoogle(host = 'localhost:8787') {
    const start = await app.request(`http://${host}/api/v1/auth/google`, { headers: { host } });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const cookie = start.headers.get('set-cookie')!;
    return { start, state, cookie, cookiePair: cookie.split(';')[0]! };
  }
  async function callback(profile: Record<string, unknown> | null, opts: { host?: string; state?: string; cookie?: string | null; tokenOk?: boolean } = {}) {
    const host = opts.host ?? 'localhost:8787';
    const s = await startGoogle(host);
    globalThis.fetch = googleFetch(profile, opts.tokenOk ?? true);
    const headers: Record<string, string> = { host };
    const cookie = opts.cookie === undefined ? s.cookiePair : opts.cookie;
    if (cookie) headers['cookie'] = cookie;
    const res = await app.request(`http://${host}/api/v1/auth/google/callback?code=c&state=${encodeURIComponent(opts.state ?? s.state)}`, { headers });
    globalThis.fetch = realFetch;
    return { res, s };
  }
  const sessionCount = async () => Number((await pool.query('SELECT count(*) FROM sessions')).rows[0].count);
  const userByEmail = async (e: string) => (await pool.query('SELECT * FROM users WHERE email=$1', [e])).rows[0];

  {
    const { s } = await callback(null);
    check('B1-state-cookie-attrs', /HttpOnly/i.test(s.cookie) && /SameSite=Lax/i.test(s.cookie) && /Max-Age=600/.test(s.cookie),
      `state cookie: ${s.cookie}`);
    const remote = await startGoogle('flowboard.example.com');
    check('B1b-state-cookie-secure-off-localhost', /Secure/.test(remote.cookie), remote.cookie);
  }
  for (const [id, profile] of [
    ['B2-unverified', { sub: 'g1', email: 'b2@flowboard.example', email_verified: false }],
    ['B3-missing-claim', { sub: 'g2', email: 'b3@flowboard.example' }],
    ['B4-string-true-claim', { sub: 'g3', email: 'b4@flowboard.example', email_verified: 'true' }],
    ['B5-missing-email', { sub: 'g4', email_verified: true }],
  ] as const) {
    const before = await sessionCount();
    const { res } = await callback(profile as Record<string, unknown>);
    const sc = res.headers.get('set-cookie') ?? '';
    check(id, res.status >= 400 && !sc.includes('flowboard_session=') && (await sessionCount()) === before &&
      !(await userByEmail(String((profile as any).email ?? 'none'))),
      `status ${res.status}; no session cookie, no session row, no user row`);
  }
  {
    const before = await sessionCount();
    const { res } = await callback({ sub: 'g5', email: 'b6@flowboard.example', email_verified: true }, { state: 'forged' });
    check('B6-state-mismatch', res.status === 403 && (await sessionCount()) === before, `status ${res.status}`);
    const r2 = await callback({ sub: 'g5', email: 'b6@flowboard.example', email_verified: true }, { cookie: null });
    check('B7-missing-state-cookie', r2.res.status === 403, `status ${r2.res.status}`);
    outbound = [];
    const r3 = await callback({ sub: 'g5', email: 'b6@flowboard.example', email_verified: true }, { state: 'forged' });
    check('B8-no-outbound-before-state-check', outbound.length === 0 && r3.res.status === 403, `outbound calls ${outbound.length}`);
    const r4 = await callback({ sub: 'g5', email: 'b6@flowboard.example', email_verified: true }, { tokenOk: false });
    check('B9-token-exchange-failure-no-session', r4.res.status === 400 && !(r4.res.headers.get('set-cookie') ?? '').includes('flowboard_session='), `status ${r4.res.status}`);
    const r5 = await callback(null);
    check('B10-userinfo-failure-no-session', r5.res.status === 400 && !(r5.res.headers.get('set-cookie') ?? '').includes('flowboard_session='), `status ${r5.res.status}`);
  }
  {
    const before = await sessionCount();
    const { res } = await callback({ sub: 'g6', email: 'New.Person@Flowboard.example', email_verified: true, name: 'New Person' }, { host: 'flowboard.example.com' });
    const sc = res.headers.get('set-cookie') ?? '';
    const user = await userByEmail('new.person@flowboard.example');
    const ws = user ? (await pool.query('SELECT count(*) FROM workspaces WHERE owner_id=$1', [user.id])).rows[0].count : null;
    check('B11-verified-signin', res.status === 302 && /flowboard_session=[0-9a-f]{64}/.test(sc) && /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc) && /Secure/.test(sc) && (await sessionCount()) === before + 1 && !!user,
      `status ${res.status}; location ${res.headers.get('location')}; cookie ${sc.replace(/=[0-9a-f]{64}/, '=<redacted>')}`);
    note('B12-workspace-auto-create', `first Google sign-in creates ${ws} owned workspace(s) for the new account (product behavior; Owner of an empty personal workspace only)`);
  }
  {
    // Account linking by verified email: pre-existing account (e.g. created via invitation acceptance/dev) is signed in.
    const existing = await createDevUserAndSession('linked@flowboard.example', 'Chosen Name', pool);
    await pool.query(`UPDATE users SET display_name='Chosen Name' WHERE id=$1`, [existing.user.id]);
    const { res } = await callback({ sub: 'g7', email: 'LINKED@flowboard.example', email_verified: true, name: 'Google Name' });
    const after = await userByEmail('linked@flowboard.example');
    check('B13-link-by-verified-email-same-id', res.status === 302 && after.id === existing.user.id, `user id preserved: ${after.id === existing.user.id}`);
    note('B14-profile-overwrite', `display_name after Google sign-in = '${after.display_name}' (user-chosen 'Chosen Name' overwritten by provider name on every login)`);
    // Concurrency: two simultaneous first sign-ins for a brand-new email must not create two workspaces.
    const s1 = await startGoogle(); const s2 = await startGoogle();
    globalThis.fetch = googleFetch({ sub: 'g8', email: 'race@flowboard.example', email_verified: true });
    const [ra, rb] = await Promise.all([s1, s2].map((s) => app.request(`http://localhost:8787/api/v1/auth/google/callback?code=c&state=${s.state}`, { headers: { host: 'localhost:8787', cookie: s.cookiePair } })));
    globalThis.fetch = realFetch;
    const ru = await userByEmail('race@flowboard.example');
    const wsCount = Number((await pool.query('SELECT count(*) FROM workspaces WHERE owner_id=$1', [ru.id])).rows[0].count);
    check('B15-parallel-first-signin-single-workspace', ra!.status === 302 && rb!.status === 302 && wsCount === 1, `statuses ${ra!.status}/${rb!.status}; workspaces ${wsCount}`);
    // Error reflection is JSON, not HTML.
    const e = await app.request('http://localhost:8787/api/v1/auth/google/callback?error=%3Cscript%3Ealert(1)%3C/script%3E');
    check('B16-error-param-json-only', e.status === 400 && (e.headers.get('content-type') ?? '').includes('application/json'), `status ${e.status} ct ${e.headers.get('content-type')}`);
  }
  delete process.env['GOOGLE_CLIENT_ID'];
  delete process.env['GOOGLE_CLIENT_SECRET'];

  // =====================================================================
  // C. Admin secret, /system and dev-login gating (Node runtime)
  // =====================================================================
  const env = process.env as Record<string, string | undefined>;
  const savedEnv = { NODE_ENV: env['NODE_ENV'], DEV_LOGIN_SECRET: env['DEV_LOGIN_SECRET'], DEV_LOGIN_ENABLED: env['DEV_LOGIN_ENABLED'] };
  const restoreEnv = () => { for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete env[k]; else env[k] = v; } };
  const status = (secret?: string, e?: Record<string, unknown>) => app.request('/api/v1/system/status', { headers: secret ? { 'x-dev-secret': secret } : {} }, e);
  const devLogin = (email: string, secret?: string, e?: Record<string, unknown>) => app.request('/api/v1/session/dev-login', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-dev-secret': secret } : {}) }, body: JSON.stringify({ email }) }, e);
  try {
    delete env['DEV_LOGIN_SECRET'];
    check('C1-test-mode-default-secret-only-in-test', (await status('flowboard-dev-secret')).status === 200, 'NODE_ENV=test accepts built-in test secret (expected, test-only)');
    for (const mode of ['production', 'development', 'staging']) {
      env['NODE_ENV'] = mode; delete env['DEV_LOGIN_SECRET']; delete env['DEV_LOGIN_ENABLED'];
      const a = await status('flowboard-dev-secret');
      const b = await app.request('/api/v1/system/migrate', { method: 'POST', headers: { 'x-dev-secret': 'flowboard-dev-secret' } });
      const d = await devLogin(`dl-${mode}@flowboard.example`);
      check(`C2-${mode}-no-default-secret`, a.status === 403 && b.status === 403, `status ${a.status}, migrate ${b.status}`);
      check(`C3-${mode}-dev-login-closed`, d.status === 404, `dev-login ${d.status}`);
      env['DEV_LOGIN_SECRET'] = 'short-secret-31-characters-xxxx'.slice(0, 31);
      check(`C4-${mode}-short-secret-rejected`, (await status(env['DEV_LOGIN_SECRET'])).status === 403, '31-char secret closed');
      env['DEV_LOGIN_SECRET'] = 'x'.repeat(40);
      check(`C5-${mode}-long-secret-works`, (await status('x'.repeat(40))).status === 200 && (await status('x'.repeat(39))).status === 403, '40-char secret opens /system/status only with exact value');
    }
    // Worker-style binding: short DEV_LOGIN_SECRET in c.env with no process secret.
    env['NODE_ENV'] = 'production'; delete env['DEV_LOGIN_SECRET'];
    check('C6-binding-short-secret-closed', (await status('abc', { DEV_LOGIN_SECRET: 'abc' })).status === 403, 'c.env short secret rejected');
    check('C7-binding-long-secret-open', (await status('y'.repeat(32), { DEV_LOGIN_SECRET: 'y'.repeat(32) })).status === 200, 'c.env 32-char secret accepted');
    // Node development mode
    env['NODE_ENV'] = 'development'; env['DEV_LOGIN_ENABLED'] = 'true'; env['DEV_LOGIN_SECRET'] = 'z'.repeat(32);
    const fresh = await devLogin('dev-fresh@flowboard.example');
    const existingNoSecret = await devLogin('linked@flowboard.example');
    const existingSecret = await devLogin('linked@flowboard.example', 'z'.repeat(32));
    check('C8-dev-mode-existing-account-needs-secret', existingNoSecret.status === 403 && existingSecret.status === 200, `existing w/o secret ${existingNoSecret.status}, with ${existingSecret.status}`);
    note('C9-dev-mode-new-account', `NODE_ENV=development + DEV_LOGIN_ENABLED: brand-new email session issued without secret -> ${fresh.status} (local-only opt-in; Node binds 127.0.0.1)`);
    const hyper = await devLogin('dev-hyper@flowboard.example', 'z'.repeat(32), { HYPERDRIVE: { connectionString: 'postgres://unused' } });
    check('C10-hyperdrive-binding-closes-dev-login', hyper.status === 404, `dev-login with Worker binding ${hyper.status}`);
    env['NODE_ENV'] = 'test';
    const hyperTest = await devLogin('dev-hyper2@flowboard.example', undefined, { HYPERDRIVE: { connectionString: 'postgres://unused' } });
    check('C11-hyperdrive-binding-closes-dev-login-even-in-test', hyperTest.status === 404, `status ${hyperTest.status}`);
    env['NODE_ENV'] = 'production'; env['DEV_LOGIN_ENABLED'] = 'true'; env['DEV_LOGIN_SECRET'] = 'z'.repeat(32);
    check('C12-production-ignores-enable-flag', (await devLogin('dev-prod@flowboard.example', 'z'.repeat(32))).status === 404, 'NODE_ENV=production dev-login stays 404');
  } finally {
    restoreEnv();
  }

  // =====================================================================
  // D. CORS and cross-origin simple requests
  // =====================================================================
  {
    env['CORS_ORIGIN'] = 'https://flowboard-app.pages.dev, https://app.flowboard.example';
    const pre = async (origin: string) => (await app.request('/api/v1/session', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } })).headers.get('access-control-allow-origin');
    const denied = ['https://evil.pages.dev', 'https://evil.workers.dev', 'https://flowboard-app.pages.dev.evil.com', 'http://localhost.evil.com', 'null', 'https://app.flowboard.example.evil', 'http://flowboard-app.pages.dev'];
    const deniedRes = await Promise.all(denied.map(pre));
    check('D1-cors-denies-untrusted', deniedRes.every((v) => v === null), denied.map((o, i) => `${o}=>${deniedRes[i]}`).join('; '));
    const allowed = ['http://localhost:5173', 'http://127.0.0.1:3000', 'https://flowboard-app.pages.dev', 'https://app.flowboard.example'];
    const allowedRes = await Promise.all(allowed.map(pre));
    check('D2-cors-allows-local-and-configured', allowed.every((o, i) => allowedRes[i] === o), allowed.join(', '));
    delete env['CORS_ORIGIN'];
  }

  // =====================================================================
  // E. Board access matrix through mounted routes
  // =====================================================================
  const owner = await createDevUserAndSession('e-owner@test.invalid', 'Owner', pool);
  const mgr = await createDevUserAndSession('e-mgr@test.invalid', 'Manager', pool);
  const mbr = await createDevUserAndSession('e-mbr@test.invalid', 'Member', pool);
  const vwr = await createDevUserAndSession('e-vwr@test.invalid', 'Viewer', pool);
  const nog = await createDevUserAndSession('e-nogrant@test.invalid', 'NoGrant', pool);
  const rev = await createDevUserAndSession('e-revoked@test.invalid', 'Revoked', pool);
  const sib = await createDevUserAndSession('e-sibling@test.invalid', 'Sibling', pool);
  const stranger = await createDevUserAndSession('e-stranger@test.invalid', 'Stranger', pool);
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('ew','E WS','UTC',$1,NOW(),NOW())`, [owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('ep','ew','E Project',NOW(),NOW()),('ep2','ew','E Sibling',NOW(),NOW())`);
  await pool.query(
    `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES
     ('m1','ep','ew',$1,'manager','active',NOW(),NOW()),('m2','ep','ew',$2,'member','active',NOW(),NOW()),
     ('m3','ep','ew',$3,'viewer','active',NOW(),NOW()),('m4','ep','ew',$4,'member','active',NOW(),NOW()),
     ('m5','ep','ew',$5,'member','active',NOW(),NOW()),('m6','ep2','ew',$6,'manager','active',NOW(),NOW())`,
    [mgr.user.id, mbr.user.id, vwr.user.id, nog.user.id, rev.user.id, sib.user.id]);

  const mkBoard = async (pid: string, name: string) => {
    const r = await req('POST', `/projects/${pid}/boards`, owner.session.id, { name });
    assert.equal(r.status, 201, `board create ${await r.clone().text()}`);
    return ((await r.json()) as any).data;
  };
  const bGranted = await mkBoard('ep', 'Granted Board');
  const bSecret = await mkBoard('ep', 'Hidden Board ZETA');
  const bSib = await mkBoard('ep2', 'Sibling Board');
  const rev0 = async (b: string) => String((await pool.query('SELECT access_revision FROM boards WHERE id=$1', [b])).rows[0].access_revision);
  const grant = async (b: string, uid: string, allow = true) => req(allow ? 'PUT' : 'DELETE', `/boards/${b}/grants/${uid}`, owner.session.id, { expectedAccessRevision: await rev0(b) });
  for (const who of [mgr, mbr, vwr, rev]) assert.equal((await grant(bGranted.id, who.user.id)).status, 200);
  assert.equal((await grant(bSib.id, sib.user.id)).status, 200);

  const snapshot = async (b: string, s: string) => req('GET', `/boards/${b}`, s);
  const ownerSnap = ((await (await snapshot(bGranted.id, owner.session.id)).json()) as any).data;
  const colG = ownerSnap.columns?.[0]?.id ?? (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position LIMIT 1', [bGranted.id])).rows[0].id;
  const colS = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position LIMIT 1', [bSecret.id])).rows[0].id;
  const bver = async (b: string) => Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [b])).rows[0].structure_version);
  const mkCard = async (b: string, col: string, s: string, title: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    req('POST', `/boards/${b}/cards`, s, { title, columnId: col, expectedBoardVersion: await bver(b), ...extra }, headers);

  const cG = await mkCard(bGranted.id, colG, owner.session.id, 'Visible Alpha', { assigneeIds: [mbr.user.id] });
  check('E0-owner-create-card', cG.status === 201, `status ${cG.status}`);
  const cardG = ((await cG.json()) as any).data;
  // Member is temporarily granted the hidden board so assignment/mention history exists, then loses it.
  assert.equal((await grant(bSecret.id, mbr.user.id)).status, 200);
  const cS = await mkCard(bSecret.id, colS, owner.session.id, 'Hidden ZETA secret', { assigneeIds: [mbr.user.id] });
  const cardS = ((await cS.json()) as any).data;
  check('E0b-owner-create-hidden-card', cS.status === 201, `status ${cS.status}`);
  const comment = await req('POST', `/cards/${cardS.id}/comments`, owner.session.id, { body: 'ZETA private discussion' });
  check('E0c-owner-comment-hidden', comment.status === 201, `status ${comment.status}`);
  await req('POST', `/cards/${cardG.id}/comments`, owner.session.id, { body: '@Member see alpha', mentions: [{ userId: mbr.user.id, start: 0, end: 7 }] });
  await req('POST', `/cards/${cardS.id}/comments`, owner.session.id, { body: '@Member see ZETA', mentions: [{ userId: mbr.user.id, start: 0, end: 7 }] });
  for (let i = 0; i < 5; i++) await processOutboxLease(pool);
  check('E0e-owner-revokes-member-hidden-grant', (await grant(bSecret.id, mbr.user.id, false)).status === 200, 'member loses hidden board after history');

  // Revoke one granted member's board grant.
  check('E0d-owner-revokes-grant', (await grant(bGranted.id, rev.user.id, false)).status === 200, 'grant removed');

  const leaks = (text: string) => /ZETA|Hidden Board/.test(text);
  const actors = { owner, mgr, mbr, vwr, nog, rev, sib, stranger } as const;
  const expectRead: Record<string, boolean> = { owner: true, mgr: true, mbr: true, vwr: true, nog: false, rev: false, sib: false, stranger: false };
  for (const [name, a] of Object.entries(actors)) {
    const s = a.session.id;
    const g = await snapshot(bGranted.id, s);
    const h = await snapshot(bSecret.id, s);
    const hc = await req('GET', `/cards/${cardS.id}`, s);
    const hcom = await req('GET', `/cards/${cardS.id}/comments`, s);
    const hact = await req('GET', `/cards/${cardS.id}/activity`, s);
    const himg = await req('GET', `/cards/${cardS.id}/images`, s);
    const hcards = await req('GET', `/boards/${bSecret.id}/cards`, s);
    const ownerOnly = name === 'owner';
    check(`E1-${name}-granted-board`, (g.status === 200) === expectRead[name]! && (expectRead[name] || g.status === 404), `granted board snapshot ${g.status}`);
    check(`E2-${name}-hidden-board-private`, ownerOnly ? h.status === 200 : [h, hc, hcom, hact, himg, hcards].every((r) => r.status === 404),
      `hidden board ${h.status}, card ${hc.status}, comments ${hcom.status}, activity ${hact.status}, images ${himg.status}, card list ${hcards.status}`);
    const lists = await Promise.all([
      req('GET', `/projects/ep/boards`, s), req('GET', `/projects/ep/cards/search?query=ZETA`, s), req('GET', `/me/tasks?projectId=ep`, s),
      req('GET', `/projects/ep/activity`, s), req('GET', `/notifications`, s), req('GET', `/workspaces/ew/my-tasks?projectId=ep`, s),
      req('GET', `/projects/ep/trash`, s), req('GET', `/session`, s), req('GET', `/projects/ep/people`, s), req('GET', '/projects', s),
    ]);
    const texts = await Promise.all(lists.map((r) => r.text()));
    if (!ownerOnly) {
      const leaked = texts.map((t, i) => (leaks(t) ? i : -1)).filter((i) => i >= 0);
      check(`E3-${name}-no-hidden-leak-in-lists`, leaked.length === 0, `statuses ${lists.map((r) => r.status).join(',')}; leaking list indexes ${JSON.stringify(leaked)}`);
    } else {
      check('E3-owner-sees-hidden-search', leaks(texts[1]!), `owner search status ${lists[1]!.status}`);
    }
  }
  // Notifications: member was mentioned on both cards; only the granted one should be visible.
  {
    const n = ((await (await req('GET', '/notifications', mbr.session.id)).json()) as any).data as any[];
    const all = (await pool.query('SELECT n.id, c.board_id FROM notifications n LEFT JOIN cards c ON c.id=n.card_id WHERE n.user_id=$1', [mbr.user.id])).rows;
    const hidden = all.filter((r) => r.board_id === bSecret.id);
    note('E4-notification-fixture', `member notifications in DB: ${all.length} (hidden-board: ${hidden.length}); visible via API: ${n.length}`);
    if (hidden.length) {
      const mark = await req('PATCH', `/notifications/${hidden[0].id}/read`, mbr.session.id);
      const readFlag = (await pool.query('SELECT read FROM notifications WHERE id=$1', [hidden[0].id])).rows[0].read;
      check('E5-hidden-notification-read-blocked', mark.status === 404 && readFlag === false, `PATCH ${mark.status}; read=${readFlag}`);
      const all2 = await req('POST', '/notifications/mark-all-read', mbr.session.id);
      const readFlag2 = (await pool.query('SELECT read FROM notifications WHERE id=$1', [hidden[0].id])).rows[0].read;
      check('E6-mark-all-skips-hidden', all2.status === 200 && readFlag2 === false, `mark-all ${all2.status}; hidden read=${readFlag2}`);
    }
  }
  // Writes
  {
    const w = async (s: string, b: string, col: string) => (await mkCard(b, col, s, `w-${crypto.randomUUID().slice(0, 6)}`)).status;
    check('E7-member-write-granted', (await w(mbr.session.id, bGranted.id, colG)) === 201, 'member creates on granted board');
    check('E8-member-write-hidden-404', (await w(mbr.session.id, bSecret.id, colS)) === 404, 'member on ungranted board');
    check('E9-viewer-write-403', (await w(vwr.session.id, bGranted.id, colG)) === 403, 'viewer on granted board');
    check('E10-nogrant-write-404', (await w(nog.session.id, bGranted.id, colG)) === 404, 'no-grant member');
    check('E11-revoked-write-404', (await w(rev.session.id, bGranted.id, colG)) === 404, 'revoked member');
    check('E12-sibling-write-404', (await w(sib.session.id, bGranted.id, colG)) === 404, 'sibling-project manager');
    const cm = await req('POST', `/cards/${cardS.id}/comments`, mbr.session.id, { body: 'x' });
    const pt = await req('PATCH', `/cards/${cardS.id}`, mbr.session.id, { title: 'pwn', expectedVersion: cardS.version });
    const del = await req('POST', `/cards/${cardS.id}/delete`, mgr.session.id, { expectedVersion: cardS.version, expectedBoardVersion: await bver(bSecret.id) });
    const tpl = new Uint8Array(await (await req('GET', `/boards/${bGranted.id}/import-template`, owner.session.id)).arrayBuffer());
    const fd = new FormData(); fd.set('file', new Blob([tpl]), 'x.xlsx'); fd.set('defaultColumnId', colS);
    const fdG = new FormData(); fdG.set('file', new Blob([tpl]), 'x.xlsx'); fdG.set('defaultColumnId', colG);
    const impG = await app.request(`http://localhost/api/v1/boards/${bGranted.id}/imports`, { method: 'POST', headers: { cookie: `flowboard_session=${mgr.session.id}`, 'Idempotency-Key': `delta-${crypto.randomUUID()}` }, body: fdG });
    note('E13a-valid-template-on-granted-board', `manager import of valid template on granted board -> ${impG.status} (template bytes ${tpl.byteLength})`);
    const imp = await app.request(`http://localhost/api/v1/boards/${bSecret.id}/imports`, { method: 'POST', headers: { cookie: `flowboard_session=${mgr.session.id}`, 'Idempotency-Key': `delta-${crypto.randomUUID()}` }, body: fd });
    const up = await req('POST', `/cards/${cardS.id}/image-uploads`, mbr.session.id, { filename: 'a.png', byteLength: 10, contentType: 'image/png', sha256: 'a'.repeat(64) });
    const col = await req('POST', `/boards/${bSecret.id}/columns`, mgr.session.id, { name: 'Pwn', color: 'red', category: 'todo', expectedBoardVersion: await bver(bSecret.id) });
    const arch = await req('POST', `/boards/${bSecret.id}/archive`, mgr.session.id, { expectedVersion: await bver(bSecret.id) });
    const tmpl = await req('GET', `/boards/${bSecret.id}/import-template`, mgr.session.id);
    check('E13-hidden-board-writes-404', [cm, pt, del, imp, up, col, arch, tmpl].every((r) => r.status === 404),
      `comment ${cm.status}, patch ${pt.status}, delete ${del.status}, import ${imp.status}, image ${up.status}, column ${col.status}, archive ${arch.status}, template ${tmpl.status}`);
    const title = (await pool.query('SELECT title, state FROM cards WHERE id=$1', [cardS.id])).rows[0];
    check('E14-hidden-card-unchanged', title.title === 'Hidden ZETA secret' && title.state === 'active', JSON.stringify(title));
  }
  // Manager creates board: no automatic grant (BRD-01 decision)
  {
    const r = await req('POST', '/projects/ep/boards', mgr.session.id, { name: 'Mgr Board' });
    const body = (await r.json()) as any;
    const id = body?.data?.id;
    const g = id ? (await pool.query('SELECT count(*) FROM board_grants WHERE board_id=$1', [id])).rows[0].count : 'n/a';
    const cols = id ? (await pool.query('SELECT count(*) FROM columns WHERE board_id=$1', [id])).rows[0].count : 'n/a';
    const after = id ? (await snapshot(id, mgr.session.id)).status : 0;
    check('E15-manager-board-create-no-grant', r.status === 201 && Number(g) === 0 && Number(cols) >= 1 && after === 404, `create ${r.status}; grants ${g}; columns ${cols}; manager GET after ${after}`);
    const mb = await req('POST', '/projects/ep/boards', mbr.session.id, { name: 'Member Board' });
    const vb = await req('POST', '/projects/ep/boards', vwr.session.id, { name: 'Viewer Board' });
    const sb = await req('POST', '/projects/ep/boards', sib.session.id, { name: 'Sibling Board' });
    check('E16-non-manager-board-create-denied', mb.status === 403 && vb.status === 403 && sb.status === 404, `member ${mb.status}, viewer ${vb.status}, sibling ${sb.status}`);
    const mgrGrant = await req('PUT', `/boards/${bGranted.id}/grants/${nog.user.id}`, mgr.session.id, { expectedAccessRevision: await rev0(bGranted.id) });
    const selfGrant = await req('PUT', `/boards/${bSecret.id}/grants/${mgr.user.id}`, mgr.session.id, { expectedAccessRevision: await rev0(bSecret.id) });
    check('E17-only-owner-administers-grants', mgrGrant.status === 404 && selfGrant.status === 404, `manager grant other ${mgrGrant.status}, self ${selfGrant.status}`);
    const sibGrant = await grant(bGranted.id, sib.user.id);
    check('E18-cannot-grant-non-member', sibGrant.status >= 400 && sibGrant.status < 500, `owner grants sibling-project user ${sibGrant.status}`);
  }
  // Replay after revocation
  {
    await grant(bGranted.id, nog.user.id);
    const key = `delta-replay-${crypto.randomUUID()}`;
    const ver = await bver(bGranted.id);
    const body = { title: 'Replay Card', columnId: colG, expectedBoardVersion: ver };
    const first = await req('POST', `/boards/${bGranted.id}/cards`, nog.session.id, body, { 'Idempotency-Key': key });
    const replay1 = await req('POST', `/boards/${bGranted.id}/cards`, nog.session.id, body, { 'Idempotency-Key': key });
    await grant(bGranted.id, nog.user.id, false);
    const replay2 = await req('POST', `/boards/${bGranted.id}/cards`, nog.session.id, body, { 'Idempotency-Key': key });
    const replay2Text = await replay2.text();
    const count = Number((await pool.query(`SELECT count(*) FROM cards WHERE title='Replay Card'`)).rows[0].count);
    check('E19-replay-before-revoke', first.status === 201 && replay1.status === 201 && count === 1, `first ${first.status}, replay ${replay1.status}, cards ${count}`);
    check('E20-replay-after-revoke-404', replay2.status === 404 && !replay2Text.includes('Replay Card'), `replay after revoke ${replay2.status}`);
  }
  // Race 1: revocation uncommitted first -> later write must fail.
  {
    await grant(bGranted.id, nog.user.id);
    const ext = await pool.connect();
    try {
      await ext.query('BEGIN');
      await ext.query(`SELECT 1 FROM project_memberships WHERE project_id='ep' AND user_id=$1 FOR UPDATE`, [nog.user.id]);
      await ext.query('UPDATE boards SET access_revision = access_revision + 1 WHERE id=$1', [bGranted.id]);
      await ext.query('DELETE FROM board_grants WHERE board_id=$1 AND user_id=$2', [bGranted.id, nog.user.id]);
      let settled = false;
      const write = mkCard(bGranted.id, colG, nog.session.id, 'Race One').then((r) => { settled = true; return r; });
      await new Promise((r) => setTimeout(r, 400));
      const blocked = !settled;
      await ext.query('COMMIT');
      const r = await write;
      const n = Number((await pool.query(`SELECT count(*) FROM cards WHERE title='Race One'`)).rows[0].count);
      check('E21-revoke-first-blocks-then-denies-write', blocked && r.status === 404 && n === 0, `blocked=${blocked}; status ${r.status}; cards ${n}`);
    } finally { ext.release(); }
  }
  // Race 2: in-flight writer holds FOR SHARE on grant -> grant DELETE route waits.
  {
    await grant(bGranted.id, nog.user.id);
    const ext = await pool.connect();
    try {
      await ext.query('BEGIN');
      await ext.query(`SELECT 1 FROM board_grants WHERE board_id=$1 AND user_id=$2 FOR SHARE`, [bGranted.id, nog.user.id]);
      let settled = false;
      const revoke = grant(bGranted.id, nog.user.id, false).then((r) => { settled = true; return r; });
      await new Promise((r) => setTimeout(r, 400));
      const blocked = !settled;
      await ext.query('COMMIT');
      const r = await revoke;
      check('E22-grant-removal-waits-for-inflight-writer', blocked && r.status === 200, `blocked=${blocked}; revoke ${r.status}`);
    } finally { ext.release(); }
  }
  // Race 2b: parallel creates by one granted member with no revocation -> classify statuses.
  {
    const res = await Promise.all(Array.from({ length: 8 }, (_, i) => mkCard(bGranted.id, colG, mbr.session.id, `Par-${i}`)));
    const bodies = await Promise.all(res.map((r) => r.text()));
    const codes = bodies.map((b) => { try { return JSON.parse(b).error?.code ?? 'ok'; } catch { return 'unparsable'; } });
    const n = Number((await pool.query(`SELECT count(*) FROM cards WHERE title LIKE 'Par-%'`)).rows[0].count);
    check('E22b-parallel-same-board-creates-no-5xx', res.every((r) => r.status < 500), `statuses ${res.map((r) => r.status).join(',')}; codes ${codes.join(',')}; created ${n}`);
    const sample = bodies.find((_, i) => res[i]!.status >= 500);
    if (sample) note('E22c-5xx-sample-body', sample.slice(0, 300));
  }
  // Race 3: many parallel writes vs membership removal through the mounted route.
  {
    await grant(bGranted.id, nog.user.id);
    const writes = Array.from({ length: 12 }, (_, i) => mkCard(bGranted.id, colG, nog.session.id, `Race3-${i}`));
    const remove = req('DELETE', `/projects/ep/members/${nog.user.id}`, owner.session.id);
    const res = await Promise.all([...writes, remove]);
    const removeStatus = res.at(-1)!.status;
    const statuses = res.slice(0, -1).map((r) => r.status);
    const grantsLeft = Number((await pool.query('SELECT count(*) FROM board_grants WHERE user_id=$1', [nog.user.id])).rows[0].count);
    const post = await mkCard(bGranted.id, colG, nog.session.id, 'Race3-after');
    check('E23-membership-removal-clears-grants', [200, 204].includes(removeStatus) && grantsLeft === 0 && post.status === 404,
      `remove ${removeStatus}; grants left ${grantsLeft}; write after ${post.status}; parallel statuses ${statuses.join(',')}`);
  }

  // =====================================================================
  // F. Missing board-grants schema fails closed (migrations 0001-0006 only)
  // =====================================================================
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-legacy-'));
    const src = path.resolve(import.meta.dirname, '../../../database/migrations');
    for (const f of fs.readdirSync(src).filter((f) => /^000[1-6]_/.test(f))) fs.copyFileSync(path.join(src, f), path.join(tmp, f));
    await runMigrations(legacyPool, { migrationsDir: tmp });
    fs.rmSync(tmp, { recursive: true, force: true });
    const lo = await createDevUserAndSession('l-owner@test.invalid', 'LOwner', legacyPool);
    const lm = await createDevUserAndSession('l-member@test.invalid', 'LMember', legacyPool);
    await legacyPool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('lw','L','UTC',$1,NOW(),NOW())`, [lo.user.id]);
    await legacyPool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('lp','lw','LP',NOW(),NOW())`);
    await legacyPool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES ('lm','lp','lw',$1,'member','active',NOW(),NOW())`, [lm.user.id]);
    await legacyPool.query(`INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at) VALUES ('lb','lw','lp','Legacy Secret Board',NOW(),NOW())`);
    await legacyPool.query(`INSERT INTO columns (id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES ('lc','lw','lp','lb','Todo','blue','todo',0,NOW(),NOW())`);
    await legacyPool.query(`INSERT INTO cards (id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at) VALUES ('lcard','lw','lp','lb','lc','Legacy Card Title','none',1,'active',NOW(),NOW())`);
    const legacyApp = createApp(async () => {}, { pool: legacyPool });
    const lreq = (p: string) => legacyApp.request(`http://localhost/api/v1${p}`, { headers: { cookie: `flowboard_session=${lm.session.id}` } });
    const rs = await Promise.all(['/boards/lb', '/cards/lcard', '/projects/lp/boards', '/projects/lp/cards/search?query=Legacy', '/me/tasks', '/boards/lb/cards'].map(lreq));
    const texts = await Promise.all(rs.map((r) => r.text()));
    const leaked = texts.some((t) => /Legacy Secret Board|Legacy Card Title/.test(t));
    check('F1-missing-grants-schema-fails-closed', !leaked && rs.every((r) => r.status !== 200 || !/Legacy/.test('')),
      `statuses ${rs.map((r) => r.status).join(',')}; leaked=${leaked}`);
    // Restore the shared global pool for the main schema (createApp sets it globally).
    createApp(async () => {}, { pool });
  }

  // =====================================================================
  // G. Cross-origin "simple" POST without Idempotency-Key (CSRF surface note)
  // =====================================================================
  {
    const r = await app.request('http://localhost/api/v1/notifications/mark-all-read', {
      method: 'POST', headers: { cookie: `flowboard_session=${mbr.session.id}`, origin: 'https://attacker.example', 'content-type': 'text/plain' }, body: '{}' });
    note('G1-no-origin-check-on-simple-post', `cross-origin text/plain POST mark-all-read with cookie -> ${r.status} (relies on SameSite=Lax; API.md promises strict Origin checks)`);
  }
} finally {
  globalThis.fetch = realFetch;
  await pool.end();
  await legacyPool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.query(`DROP SCHEMA "${legacySchema}" CASCADE`);
  await admin.end();
}

console.log(`\nSUMMARY: ${results.filter((r) => r.startsWith('PASS')).length} pass, ${failures} fail, ${results.filter((r) => r.startsWith('NOTE')).length} notes`);
process.exitCode = failures ? 1 : 0;
