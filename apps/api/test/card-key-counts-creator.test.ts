import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { createApp } from '../src/http/app.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
const addDays = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

test('card key, description excerpt, due counters and createdBy are granted-only and correct', { skip: !testUrl && 'Set FLOWBOARD_ACCESS_TEST_DATABASE_URL to a disposable local database.' }, async (t) => {
  const schema = `ck_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testUrl, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: testUrl, max: 4, options: `-c search_path=${schema}` });
  try {
    await runMigrations(pool);
    const owner = await createDevUserAndSession('owner@cardkeys.test', 'Owner Person', pool);
    const manager = await createDevUserAndSession('manager@cardkeys.test', 'Manager Person', pool);
    const viewer = await createDevUserAndSession('viewer@cardkeys.test', 'Viewer Person', pool);
    const outsider = await createDevUserAndSession('outsider@cardkeys.test', 'Outsider Person', pool);
    await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','W','UTC',$1,NOW(),NOW())`, [owner.user.id]);
    await pool.query(`INSERT INTO projects (id,workspace_id,name,key_prefix,created_at,updated_at) VALUES ('p','w','Web Project','WEB',NOW(),NOW())`);
    await pool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
                      VALUES ('pm1','p','w',$1,'manager','active',1,NOW(),NOW()), ('pm2','p','w',$2,'viewer','active',1,NOW(),NOW())`, [manager.user.id, viewer.user.id]);
    const app = createApp(async () => {}, { pool });
    const as = (session: { id: string }) => ({ cookie: `flowboard_session=${session.id}`, 'content-type': 'application/json', 'Idempotency-Key': 'k-' + crypto.randomUUID() });

    const boardId = ((await (await app.request('/api/v1/projects/p/boards', { method: 'POST', headers: as(owner.session), body: JSON.stringify({ name: 'B' }) })).json()) as any).data.id as string;
    await app.request(`/api/v1/boards/${boardId}/grants/${manager.user.id}`, { method: 'PUT', headers: as(owner.session), body: JSON.stringify({ expectedAccessRevision: '1' }) });
    const cols = (await pool.query('SELECT id, category FROM columns WHERE board_id=$1 ORDER BY position', [boardId])).rows as Array<{ id: string; category: string }>;
    const doneCol = cols[cols.length - 1]!;
    await pool.query(`UPDATE columns SET category = 'done' WHERE id = $1`, [doneCol.id]);
    const version = async () => Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [boardId])).rows[0].structure_version);
    const create = async (title: string, dueDate: string | null, columnId = cols[0]!.id, description = '') => {
      const res = await app.request(`/api/v1/boards/${boardId}/cards`, {
        method: 'POST', headers: as(manager.session),
        body: JSON.stringify({ title, columnId, dueDate, description, expectedBoardVersion: await version() }),
      });
      assert.equal(res.status, 201, await res.clone().text());
      return ((await res.json()) as any).data as { id: string; key?: string };
    };

    const overdue = await create('overdue', addDays(-1));
    const soonToday = await create('due today', addDays(0));
    const soonSeven = await create('due in 7', addDays(7));
    await create('due in 8', addDays(8));
    await create('done overdue', addDays(-3), doneCol.id);
    const withText = await create('excerpt', null, cols[0]!.id, '<p>Hello <b>World</b></p>\n# Heading *bold* ' + 'x'.repeat(300));

    await t.test('card keys use the project prefix and never repeat', async () => {
      const ids = [overdue, soonToday, soonSeven].map((c) => c.key);
      for (const k of ids) assert.match(k!, /^WEB-\d+$/);
      assert.equal(new Set(ids).size, 3);
    });

    await t.test('snapshot: key, descriptionExcerpt (plain text, <=160), and board-wide overdue and due-soon counts', async () => {
      const res = await app.request(`/api/v1/boards/${boardId}`, { headers: { cookie: `flowboard_session=${manager.session.id}` } });
      assert.equal(res.status, 200);
      const data = ((await res.json()) as any).data;
      assert.equal(data.totals.overdueCount, 1, 'only the active overdue card; done-column card excluded');
      assert.equal(data.totals.dueSoonCount, 2, 'today and +7 days, not +8');
      const card = data.columns.flatMap((c: any) => c.cards).find((c: any) => c.id === withText.id);
      assert.equal(card.descriptionExcerpt, 'Hello World Heading bold ' + 'x'.repeat(300)
        .slice(0, 160 - 'Hello World Heading bold '.length));
      assert.equal(card.descriptionExcerpt.length, 160);
      assert.match(card.key, /^WEB-\d+$/);
    });

    await t.test('card detail: createdBy is the creator with activeInProject, and key is present', async () => {
      const res = await app.request(`/api/v1/cards/${overdue.id}`, { headers: { cookie: `flowboard_session=${manager.session.id}` } });
      assert.equal(res.status, 200);
      const card = ((await res.json()) as any).data;
      assert.equal(card.createdBy.id, manager.user.id);
      assert.equal(card.createdBy.displayName, 'Manager Person');
      assert.equal(card.createdBy.activeInProject, true);
      assert.equal(card.key, overdue.key);
    });

    await t.test('privacy: outsider and viewer without a board grant get no snapshot, counts or createdBy', async () => {
      for (const who of [outsider, viewer]) {
        const snap = await app.request(`/api/v1/boards/${boardId}`, { headers: { cookie: `flowboard_session=${who.session.id}` } });
        assert.equal(snap.status, 404, 'snapshot must be private');
        const text = await snap.text();
        assert.ok(!text.includes('overdueCount') && !text.includes('Hello'), 'no counts or excerpt leak');
        const detail = await app.request(`/api/v1/cards/${overdue.id}`, { headers: { cookie: `flowboard_session=${who.session.id}` } });
        assert.equal(detail.status, 404);
        assert.ok(!(await detail.text()).includes('Manager Person'), 'createdBy must not leak');
      }
    });
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
