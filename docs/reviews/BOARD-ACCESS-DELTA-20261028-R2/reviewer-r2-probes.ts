// Reviewer R2 probes. Read-only against the repository; writes only to a throwaway schema
// on the isolated synthetic PostgreSQL (FLOWBOARD_ACCESS_TEST_DATABASE_URL).
// Run: node docs/reviews/BOARD-ACCESS-DELTA-20261028-R2/reviewer-r2-probes.ts
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';

const url = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
if (!url) throw new Error('FLOWBOARD_ACCESS_TEST_DATABASE_URL is required');

const results: Record<string, unknown> = {};
const schema = `r2probe_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: url, max: 12, options: `-c search_path=${schema}` });

try {
  await runMigrations(pool);
  const owner = await createDevUserAndSession('owner@r2probe.test', 'Owner', pool);
  const member = await createDevUserAndSession('member@r2probe.test', 'Member', pool);
  const viewer = await createDevUserAndSession('viewer@r2probe.test', 'Viewer', pool);
  const app = createApp(async () => {}, { pool });
  const key = () => 'k-' + crypto.randomUUID();
  const json = (sid: string | null, body?: unknown, extra: Record<string, string> = {}) => ({
    method: 'POST',
    headers: { ...(sid ? { cookie: `flowboard_session=${sid}` } : {}), 'content-type': 'application/json', 'Idempotency-Key': key(), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC',$1,NOW(),NOW())`, [owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','P',NOW(),NOW())`);
  for (const [id, u, role] of [['pm_mbr', member.user.id, 'member'], ['pm_vwr', viewer.user.id, 'viewer']] as const) {
    await pool.query(
      `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
       VALUES ($1,'p','w',$2,$3,'active',NOW(),NOW())`, [id, u, role]);
  }

  async function newBoard(name: string) {
    const r = await app.request('/api/v1/projects/p/boards', json(owner.session.id, { name }));
    const id = ((await r.json()) as any).data.id as string;
    const cols = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position', [id])).rows.map((x) => x.id as string);
    return { id, cols };
  }
  const boardVersion = async (id: string) => Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [id])).rows[0].structure_version);
  const revision = async (id: string) => String((await pool.query('SELECT access_revision FROM boards WHERE id=$1', [id])).rows[0].access_revision);

  // P1: repeated parallel same-board writes (create x6, then move x6), 15 rounds.
  const p1: Record<string, number> = {};
  const p1Rounds: string[][] = [];
  for (let round = 0; round < 15; round++) {
    const b = await newBoard(`R${round}`);
    const v0 = await boardVersion(b.id);
    const creates = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      app.request(`/api/v1/boards/${b.id}/cards`, json(owner.session.id, { title: `T${i}`, columnId: b.cols[0], expectedBoardVersion: v0 }))));
    const cs = creates.map((r) => r.status);
    const cards: { id: string; version: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await app.request(`/api/v1/boards/${b.id}/cards`, json(owner.session.id, { title: `M${i}`, columnId: b.cols[0], expectedBoardVersion: await boardVersion(b.id) }));
      const d = ((await r.json()) as any).data;
      cards.push({ id: d.id, version: d.version });
    }
    const v = await boardVersion(b.id);
    const moves = await Promise.all(cards.map((c) =>
      app.request(`/api/v1/cards/${c.id}/move`, json(owner.session.id, { toColumnId: b.cols[1], previousCardId: null, nextCardId: null, expectedVersion: c.version, expectedBoardVersion: v }))));
    const ms = moves.map((r) => r.status);
    p1Rounds.push([cs.sort().join(','), ms.sort().join(',')]);
    for (const s of [...cs, ...ms]) p1[String(s)] = (p1[String(s)] ?? 0) + 1;
  }
  results['P1_parallel_status_counts_15_rounds'] = p1;
  results['P1_first_rounds'] = p1Rounds.slice(0, 3);

  // P2: replay after revocation. Member creates a card with key K, Owner revokes the grant,
  // member replays the same key and body.
  const b2 = await newBoard('Replay');
  const put = await app.request(`/api/v1/boards/${b2.id}/grants/${member.user.id}`, {
    method: 'PUT',
    headers: { cookie: `flowboard_session=${owner.session.id}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedAccessRevision: await revision(b2.id) }),
  });
  results['P2_grant_put_status'] = put.status;
  const k2 = key();
  const body2 = { title: 'Replay card', columnId: b2.cols[0], expectedBoardVersion: await boardVersion(b2.id) };
  const first = await app.request(`/api/v1/boards/${b2.id}/cards`, {
    method: 'POST',
    headers: { cookie: `flowboard_session=${member.session.id}`, 'content-type': 'application/json', 'Idempotency-Key': k2 },
    body: JSON.stringify(body2),
  });
  results['P2_member_create_before_revoke_status'] = first.status;
  const rev = await app.request(`/api/v1/boards/${b2.id}/grants/${member.user.id}`, {
    method: 'DELETE',
    headers: { cookie: `flowboard_session=${owner.session.id}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedAccessRevision: await revision(b2.id) }),
  });
  results['P2_owner_revoke_status'] = rev.status;
  const replay = await app.request(`/api/v1/boards/${b2.id}/cards`, {
    method: 'POST',
    headers: { cookie: `flowboard_session=${member.session.id}`, 'content-type': 'application/json', 'Idempotency-Key': k2 },
    body: JSON.stringify(body2),
  });
  results['P2_member_replay_after_revoke_status'] = replay.status;
  results['P2_replay_body_has_card_title'] = (await replay.text()).includes('Replay card');

  // P3: anonymous status-code difference between an existing and a missing board.
  const existing = await app.request(`/api/v1/boards/${b2.id}`);
  const missing = await app.request(`/api/v1/boards/brd_does_not_exist`);
  results['P3_anon_existing_board_status'] = existing.status;
  results['P3_anon_missing_board_status'] = missing.status;

  // P4: viewer with a grant cannot write (expect 403 after grant check).
  const put4 = await app.request(`/api/v1/boards/${b2.id}/grants/${viewer.user.id}`, {
    method: 'PUT',
    headers: { cookie: `flowboard_session=${owner.session.id}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedAccessRevision: await revision(b2.id) }),
  });
  const vw = await app.request(`/api/v1/boards/${b2.id}/cards`, {
    method: 'POST',
    headers: { cookie: `flowboard_session=${viewer.session.id}`, 'content-type': 'application/json', 'Idempotency-Key': key() },
    body: JSON.stringify({ title: 'viewer', columnId: b2.cols[0], expectedBoardVersion: await boardVersion(b2.id) }),
  });
  results['P4_viewer_grant_put_status'] = put4.status;
  results['P4_viewer_write_status'] = vw.status;

  // P5: CSRF origin/cookie variants (no session needed for the rejected cases; a valid-looking
  // session falls through to auth, which returns 401 because the synthetic session is absent).
  const variants: [string, Record<string, string>][] = [
    ['origin localhost lookalike', { cookie: 'flowboard_session=x', origin: 'http://localhost.evil.example' }],
    ['origin localhost port trick', { cookie: 'flowboard_session=x', origin: 'http://localhost:8080.evil.example' }],
    ['origin userinfo trick', { cookie: 'flowboard_session=x', origin: 'http://localhost:3000@evil.example' }],
    ['origin uppercase own host', { cookie: 'flowboard_session=x', origin: 'HTTPS://APP.FLOWBOARD.EXAMPLE' }],
    ['origin null', { cookie: 'flowboard_session=x', origin: 'null' }],
    ['referer only evil', { cookie: 'flowboard_session=x', referer: 'https://evil.example/' }],
    ['no origin no referer no fetch-site', { cookie: 'flowboard_session=x' }],
    ['leading space cookie', { cookie: '  flowboard_session=x', origin: 'https://evil.example' }],
    ['other cookie name only', { cookie: 'flowboard_sess=x', origin: 'https://evil.example' }],
    ['two origins header style', { cookie: 'flowboard_session=x', origin: 'https://evil.example, https://app.flowboard.example' }],
  ];
  const csrf: Record<string, number> = {};
  for (const [label, headers] of variants) {
    const r = await app.request('https://app.flowboard.example/api/v1/session/logout', { method: 'POST', headers });
    csrf[label] = r.status;
  }
  results['P5_origin_variant_status'] = csrf;
} finally {
  console.log(JSON.stringify(results, null, 2));
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
