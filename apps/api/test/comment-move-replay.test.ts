import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { createApp } from '../src/http/app.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];

// Setup shared by both tests: a workspace owner, a project, a board with two columns and one card,
// and a manager with an explicit board grant (so the manager, not the owner, makes the writes).
async function setup(pool: pg.Pool) {
  const owner = await createDevUserAndSession('owner@interleave.test', 'Owner', pool);
  const manager = await createDevUserAndSession('manager@interleave.test', 'Manager', pool);
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC',$1,NOW(),NOW())`, [owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','P',NOW(),NOW())`);
  await pool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
                    VALUES ('pm1','p','w',$1,'manager','active',1,NOW(),NOW())`, [manager.user.id]);
  const app = createApp(async () => {}, { pool });
  const as = (session: { id: string }, extra: Record<string, string> = {}) => ({
    cookie: `flowboard_session=${session.id}`,
    'content-type': 'application/json',
    'Idempotency-Key': 'k-' + crypto.randomUUID(),
    ...extra,
  });
  const created = await app.request('/api/v1/projects/p/boards', { method: 'POST', headers: as(owner.session), body: JSON.stringify({ name: 'B' }) });
  const boardId = ((await created.json()) as any).data.id as string;
  const revision = async () => Number((await pool.query('SELECT access_revision FROM boards WHERE id=$1', [boardId])).rows[0].access_revision);
  const grant = await app.request(`/api/v1/boards/${boardId}/grants/${manager.user.id}`, { method: 'PUT', headers: as(owner.session), body: JSON.stringify({ expectedAccessRevision: String(await revision()) }) });
  assert.equal(grant.status, 200, await grant.clone().text());
  const cols = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position', [boardId])).rows.map((r) => r.id as string);
  const boardVersion = async () => Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);
  const card = await app.request(`/api/v1/boards/${boardId}/cards`, { method: 'POST', headers: as(manager.session), body: JSON.stringify({ title: 'C', columnId: cols[0], expectedBoardVersion: await boardVersion() }) });
  assert.equal(card.status, 201);
  const cardData = ((await card.json()) as any).data;
  return { app, owner, manager, boardId, cols, cardId: cardData.id as string, cardVersion: cardData.version as number, boardVersion, revision, as };
}

test('comment POST and card move on one card interleave without deadlock (review R2-01)', { skip: !testUrl && 'Set FLOWBOARD_ACCESS_TEST_DATABASE_URL to a disposable local database.' }, async () => {
  const schema = `il_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: testUrl, max: 16, options: `-c search_path=${schema}` });
  try {
    await runMigrations(pool);
    const s = await setup(pool);
    const before = Number((await pool.query(`SELECT COALESCE(sum(deadlocks),0)::int AS d FROM pg_stat_database`)).rows[0].d);
    for (let round = 0; round < 8; round++) {
      const v = await s.boardVersion();
      const [comments, moves] = await Promise.all([
        Promise.all(Array.from({ length: 4 }, (_, i) =>
          s.app.request(`/api/v1/cards/${s.cardId}/comments`, { method: 'POST', headers: s.as(s.manager.session), body: JSON.stringify({ body: `c${round}-${i}` }) }))),
        s.app.request(`/api/v1/cards/${s.cardId}/move`, { method: 'POST', headers: s.as(s.manager.session), body: JSON.stringify({ toColumnId: s.cols[round % 2 === 0 ? 1 : 0], previousCardId: null, nextCardId: null, expectedVersion: s.cardVersion + round, expectedBoardVersion: v }) }),
      ]);
      for (const r of [...comments, moves]) {
        assert.ok([200, 201, 400, 409, 404].includes(r.status), `unexpected status ${r.status}`);
      }
    }
    const after = Number((await pool.query(`SELECT COALESCE(sum(deadlocks),0)::int AS d FROM pg_stat_database`)).rows[0].d);
    assert.equal(after - before, 0, 'no deadlocks may be raised by comment-vs-move interleaving');
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});

test('a board-scoped replay after the grant is revoked returns 404 and no saved body (review R2-04)', { skip: !testUrl && 'Set FLOWBOARD_ACCESS_TEST_DATABASE_URL to a disposable local database.' }, async () => {
  const schema = `rp_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: testUrl, max: 4, options: `-c search_path=${schema}` });
  try {
    await runMigrations(pool);
    const s = await setup(pool);
    const key = 'replay-' + crypto.randomUUID();
    const body = JSON.stringify({ body: 'before revocation' });
    const first = await s.app.request(`/api/v1/cards/${s.cardId}/comments`, { method: 'POST', headers: { ...s.as(s.manager.session), 'Idempotency-Key': key }, body });
    assert.equal(first.status, 201);

    const revoke = await s.app.request(`/api/v1/boards/${s.boardId}/grants/${s.manager.user.id}`, { method: 'DELETE', headers: s.as(s.owner.session), body: JSON.stringify({ expectedAccessRevision: String(await s.revision()) }) });
    assert.ok(revoke.status === 200 || revoke.status === 204, `revoke status ${revoke.status}`);

    const replay = await s.app.request(`/api/v1/cards/${s.cardId}/comments`, { method: 'POST', headers: { ...s.as(s.manager.session), 'Idempotency-Key': key }, body });
    assert.equal(replay.status, 404);
    const text = await replay.text();
    assert.ok(!text.includes('before revocation'), 'replay must not disclose the saved comment body');
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
