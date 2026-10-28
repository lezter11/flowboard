import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { createApp } from '../src/http/app.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
const addDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

test('optional parity fields (trash key, column tone, my-tasks key, card activity links) respect board grants', { skip: !testUrl && 'Set FLOWBOARD_ACCESS_TEST_DATABASE_URL to a disposable local database.' }, async (t) => {
  const schema = `pf_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: testUrl, max: 4, options: `-c search_path=${schema}` });
  try {
    await runMigrations(pool);
    const owner = await createDevUserAndSession('owner@parity.test', 'Owner Person', pool);
    const manager = await createDevUserAndSession('manager@parity.test', 'Manager Person', pool);
    const viewer = await createDevUserAndSession('viewer@parity.test', 'Viewer Person', pool);
    await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC',$1,NOW(),NOW())`, [owner.user.id]);
    await pool.query(`INSERT INTO projects (id,workspace_id,name,key_prefix,created_at,updated_at) VALUES ('p','w','Web Project','WEB',NOW(),NOW())`);
    await pool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
                      VALUES ('pm1','p','w',$1,'manager','active',1,NOW(),NOW()), ('pm2','p','w',$2,'viewer','active',1,NOW(),NOW())`, [manager.user.id, viewer.user.id]);
    const app = createApp(async () => {}, { pool });
    const as = (session: { id: string }) => ({ cookie: `flowboard_session=${session.id}`, 'content-type': 'application/json', 'Idempotency-Key': 'k-' + crypto.randomUUID() });
    const boardId = ((await (await app.request('/api/v1/projects/p/boards', { method: 'POST', headers: as(owner.session), body: JSON.stringify({ name: 'B' }) })).json()) as any).data.id as string;
    await app.request(`/api/v1/boards/${boardId}/grants/${manager.user.id}`, { method: 'PUT', headers: as(owner.session), body: JSON.stringify({ expectedAccessRevision: '1' }) });
    const cols = (await pool.query('SELECT id FROM columns WHERE board_id=$1 ORDER BY position', [boardId])).rows.map((r) => r.id as string);
    const version = async () => Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);
    const createRes = await app.request(`/api/v1/boards/${boardId}/cards`, { method: 'POST', headers: as(manager.session), body: JSON.stringify({ title: 'Ship parity', columnId: cols[0], dueDate: addDays(1), assigneeIds: [manager.user.id], expectedBoardVersion: await version() }) });
    assert.equal(createRes.status, 201, await createRes.clone().text());
    const card = ((await createRes.json()) as any).data as { id: string; version: number };

    await t.test('card activity carries cardTitle, cardKey and boardId for a granted reader', async () => {
      const res = await app.request(`/api/v1/cards/${card.id}/activity`, { headers: { cookie: `flowboard_session=${manager.session.id}` } });
      assert.equal(res.status, 200);
      const body = (await res.json()) as any;
      const item = body.data[0];
      assert.equal(item.cardTitle, 'Ship parity');
      assert.match(item.cardKey, /^WEB-\d+$/);
      assert.equal(item.boardId, boardId);
    });

    await t.test('viewer without a board grant gets no card activity, so no title or key', async () => {
      const res = await app.request(`/api/v1/cards/${card.id}/activity`, { headers: { cookie: `flowboard_session=${viewer.session.id}` } });
      assert.equal(res.status, 404);
      assert.ok(!(await res.text()).includes('Ship parity'));
    });

    await t.test('my-tasks rows carry key for a granted assignee, and nothing for an ungranted one', async () => {
      const res = await app.request('/api/v1/me/tasks?projectId=p', { headers: { cookie: `flowboard_session=${manager.session.id}` } });
      assert.equal(res.status, 200);
      const rows = ((await res.json()) as any).data as any[];
      const row = rows.find((r) => r.id === card.id);
      assert.ok(row, 'assigned card is listed');
      assert.match(row.key, /^WEB-\d+$/);
      const hidden = await app.request('/api/v1/me/tasks?projectId=p', { headers: { cookie: `flowboard_session=${viewer.session.id}` } });
      assert.ok(!(await hidden.text()).includes('Ship parity'));
    });

    await t.test('trash rows carry key for a granted manager; no-grant viewer sees no trash row', async () => {
      const trash = await app.request(`/api/v1/cards/${card.id}/delete`, { method: 'POST', headers: as(manager.session), body: JSON.stringify({ expectedVersion: card.version, expectedBoardVersion: await version() }) });
      assert.equal(trash.status, 200, await trash.clone().text());
      const list = await app.request('/api/v1/projects/p/trash', { headers: { cookie: `flowboard_session=${manager.session.id}` } });
      const row = ((await list.json()) as any).data.find((r: any) => r.id === card.id);
      assert.match(row.key, /^WEB-\d+$/);
      const hidden = await app.request('/api/v1/projects/p/trash', { headers: { cookie: `flowboard_session=${viewer.session.id}` } });
      assert.ok(!(await hidden.text()).includes('Ship parity'));
    });

    await t.test('column tone is null by default, exposed when set, and rejects unknown names', async () => {
      const snap = await app.request(`/api/v1/boards/${boardId}`, { headers: { cookie: `flowboard_session=${manager.session.id}` } });
      const first = ((await snap.json()) as any).data.columns[0];
      assert.equal(first.tone ?? null, null);
      await pool.query(`UPDATE columns SET tone = 'lavender' WHERE id = $1`, [cols[0]]);
      const after = ((await (await app.request(`/api/v1/boards/${boardId}`, { headers: { cookie: `flowboard_session=${manager.session.id}` } })).json()) as any).data.columns[0];
      assert.equal(after.tone, 'lavender');
      await assert.rejects(pool.query(`UPDATE columns SET tone = 'neon' WHERE id = $1`, [cols[0]]), /check constraint/);
    });
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
