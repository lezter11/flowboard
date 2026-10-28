// Reviewer R3 replay-after-revocation probe (read-only against the repository; writes only to a
// throwaway schema on the isolated synthetic PostgreSQL). A project Member holding a board grant
// performs a write with an Idempotency-Key, the Owner revokes the grant, and the Member replays the
// same key and body. Expected: 404 with no saved body. Each route is exercised through createApp.
// Run: node docs/reviews/BOARD-ACCESS-DELTA-20261028-R3/reviewer-r3-replay-probe.ts
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';

const url = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
if (!url) throw new Error('FLOWBOARD_ACCESS_TEST_DATABASE_URL is required');

const schema = `r3rep_${crypto.randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: url, max: 1 });
await admin.query(`CREATE SCHEMA "${schema}"`);
const pool = new pg.Pool({ connectionString: url, max: 6, options: `-c search_path=${schema}` });
const out: Record<string, unknown> = {};

try {
  await runMigrations(pool);
  const owner = await createDevUserAndSession('owner@r3replay.test', 'Owner', pool);
  const member = await createDevUserAndSession('member@r3replay.test', 'Member', pool);
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC',$1,NOW(),NOW())`, [owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','P',NOW(),NOW())`);
  await pool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
                    VALUES ('pm1','p','w',$1,'member','active',1,NOW(),NOW())`, [member.user.id]);
  const app = createApp(async () => {}, { pool });
  const send = (method: string, path: string, who: { id: string }, key: string, body?: unknown) => app.request(path, {
    method,
    headers: {
      cookie: `flowboard_session=${who.id}`,
      'content-type': 'application/json',
      'Idempotency-Key': key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // Owner creates the board, a card and a comment; the Owner grants the Member this board only.
  const bres = await send('POST', '/api/v1/projects/p/boards', owner.session, 'k-board-' + crypto.randomUUID(), { name: 'B' });
  const boardId = ((await bres.json()) as any).data.id as string;
  const cols = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position', [boardId])).rows.map((r) => r.id as string);
  const bv = async () => Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);
  const rev = async () => String((await pool.query('SELECT access_revision FROM boards WHERE id=$1', [boardId])).rows[0].access_revision);
  const grant = await app.request(`/api/v1/boards/${boardId}/grants/${member.user.id}`, {
    method: 'PUT',
    headers: { cookie: `flowboard_session=${owner.session.id}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expectedAccessRevision: await rev() }),
  });
  out['grant_status'] = grant.status;
  const ownerCard = ((await (await send('POST', `/api/v1/boards/${boardId}/cards`, owner.session, 'k-seed-' + crypto.randomUUID(), { title: 'Seed', columnId: cols[0], expectedBoardVersion: await bv() })).json()) as any).data as { id: string; version: number };
  const ownerComment = ((await (await send('POST', `/api/v1/cards/${ownerCard.id}/comments`, owner.session, 'k-seed-' + crypto.randomUUID(), { body: 'seed' })).json()) as any).data as { id: string; version: number };

  // Cases: member writes once (must succeed), owner revokes, member replays the same key and body.
  // Bodies are built right before the first write so each version/board-version is current.
  const marker = 'MARKER-' + crypto.randomUUID().slice(0, 8);
  type Case = { name: string; method: string; path: string; body: () => Promise<unknown>; key: string; fixed?: unknown };
  const cases: Case[] = [
    { name: 'create_card', method: 'POST', path: `/api/v1/boards/${boardId}/cards`, key: 'k-c1-' + crypto.randomUUID(),
      body: async () => ({ title: marker, columnId: cols[0], expectedBoardVersion: await bv() }) },
    { name: 'move_card', method: 'POST', path: `/api/v1/cards/${ownerCard.id}/move`, key: 'k-c2-' + crypto.randomUUID(),
      body: async () => {
        const v = Number((await pool.query('SELECT version FROM cards WHERE id=$1', [ownerCard.id])).rows[0].version);
        return { toColumnId: cols[1], previousCardId: null, nextCardId: null, expectedVersion: v, expectedBoardVersion: await bv() };
      } },
    { name: 'patch_card', method: 'PATCH', path: `/api/v1/cards/${ownerCard.id}`, key: 'k-c3-' + crypto.randomUUID(),
      body: async () => {
        const v = Number((await pool.query('SELECT version FROM cards WHERE id=$1', [ownerCard.id])).rows[0].version);
        return { title: marker, expectedVersion: v };
      } },
    { name: 'post_comment', method: 'POST', path: `/api/v1/cards/${ownerCard.id}/comments`, key: 'k-c4-' + crypto.randomUUID(),
      body: async () => ({ body: marker }) },
  ];

  const results: Record<string, unknown> = {};
  for (const c of cases) {
    c.fixed ??= await c.body();
    const first = await send(c.method, c.path, member.session, c.key, c.fixed);
    const firstText = await first.text();
    // Revoke this board grant (Owner), then replay with the same key and body.
    const rv = await app.request(`/api/v1/boards/${boardId}/grants/${member.user.id}`, {
      method: 'DELETE',
      headers: { cookie: `flowboard_session=${owner.session.id}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedAccessRevision: await rev() }),
    });
    const replay = await send(c.method, c.path, member.session, c.key, c.fixed);
    const replayText = await replay.text();
    results[c.name] = {
      firstStatus: first.status,
      revokeStatus: rv.status,
      replayStatus: replay.status,
      replayLeaksSavedBody: replayText.includes(marker),
      firstHadMarker: firstText.includes(marker),
    };
    // Restore the grant so the next case starts with access.
    await app.request(`/api/v1/boards/${boardId}/grants/${member.user.id}`, {
      method: 'PUT',
      headers: { cookie: `flowboard_session=${owner.session.id}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedAccessRevision: await rev() }),
    });
  }
  out['cases'] = results;
} finally {
  console.log(JSON.stringify(out, null, 2));
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
