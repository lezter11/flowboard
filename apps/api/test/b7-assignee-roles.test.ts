import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// FB-AUD-03 regression, mounted over PostgreSQL. Assignees must be the owner, or an active manager
// or member with a board grant. A viewer is refused and nothing about the card changes.

const pool: pg.Pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 4);
setGlobalPool(pool);

async function fixture() {
  await runMigrations(pool);
  const s = crypto.randomBytes(4).toString('hex');
  const who = async (label: string) => (await createDevUserAndSession(`${label}.${s}@flowboard.example`, label, pool)).user.id as string;
  const owner = await who('owner');
  const managerSession = await createDevUserAndSession(`manager.${s}@flowboard.example`, 'manager', pool);
  const manager = managerSession.user.id as string;
  const member = await who('member');
  const viewer = await who('viewer');
  const ws = `ws_${s}`;
  const project = `p_${s}`;
  const board = `b_${s}`;
  const column = `c_${s}`;
  const card = `card_${s}`;
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`, [ws, owner]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'P',now(),now())`, [project, ws]);
  await pool.query(`INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at) VALUES ($1,$2,$3,'B',now(),now())`, [board, ws, project]);
  await pool.query(
    `INSERT INTO columns (id,workspace_id,project_id,board_id,name,color,category,position,version,created_at,updated_at)
     VALUES ($1,$2,$3,$4,'To do','blue','todo',0,1,now(),now())`,
    [column, ws, project, board],
  );
  await pool.query(
    `INSERT INTO cards (id,workspace_id,project_id,board_id,column_id,title,priority,position,state,version,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,'Task','none',1000,'active',1,now(),now())`,
    [card, ws, project, board, column],
  );
  for (const [label, userId, role] of [['manager', manager, 'manager'], ['member', member, 'member'], ['viewer', viewer, 'viewer']] as const) {
    await pool.query(
      `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'active',1,now(),now())`,
      [`pm_${label}_${s}`, project, ws, userId, role],
    );
  }
  await pool.query(
    `INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by)
     SELECT $1,$2,$3,u,$4 FROM unnest($5::text[]) AS u`,
    [board, project, ws, owner, [manager, member, viewer]],
  );
  // The manager has a board grant, so the write reaches the assignee rule instead of the access rule.
  return { cookie: `flowboard_session=${managerSession.session.id}`, owner, member, viewer, board, column, card, project, ws };
}

async function cardState(cardId: string) {
  const assignees = await pool.query<{ user_id: string }>('SELECT user_id FROM card_assignees WHERE card_id = $1 ORDER BY user_id', [cardId]);
  const version = await pool.query<{ version: number }>('SELECT version FROM cards WHERE id = $1', [cardId]);
  const activity = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM activity_log WHERE card_id = $1', [cardId]);
  return { assignees: assignees.rows.map((r) => r.user_id), version: version.rows[0]!.version, activity: Number(activity.rows[0]!.n) };
}

test('B-7 assignees: a viewer cannot be assigned and the card is untouched', async (t) => {
  const fx = await fixture();
  const app = createApp(async () => {}, { pool });
  const headers = (extra: Record<string, string> = {}) => ({
    cookie: fx.cookie,
    origin: 'http://localhost',
    'idempotency-key': `b7-assignee-${crypto.randomUUID()}`,
    'content-type': 'application/json',
    ...extra,
  });

  await t.test('PATCH assigning a viewer returns 422 and leaves the card and activity unchanged', async () => {
    const before = await cardState(fx.card);
    const res = await app.request(`http://localhost/api/v1/cards/${fx.card}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ assigneeIds: [fx.viewer], expectedVersion: before.version }),
    });
    assert.equal(res.status, 422, await res.clone().text());
    assert.equal(((await res.json()) as any).error.code, 'VALIDATION_ERROR');
    assert.deepEqual(await cardState(fx.card), before);
  });

  await t.test('POST creating a card with a viewer assignee returns 422 and creates nothing', async () => {
    const countBefore = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM cards WHERE board_id = $1', [fx.board]);
    const res = await app.request(`http://localhost/api/v1/boards/${fx.board}/cards`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ columnId: fx.column, title: 'New', priority: 'none', assigneeIds: [fx.viewer] }),
    });
    assert.equal(res.status, 422, await res.clone().text());
    const countAfter = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM cards WHERE board_id = $1', [fx.board]);
    assert.equal(countAfter.rows[0]!.n, countBefore.rows[0]!.n);
  });

  await t.test('the owner and a member with a grant are still assignable (positive control)', async () => {
    const before = await cardState(fx.card);
    const res = await app.request(`http://localhost/api/v1/cards/${fx.card}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ assigneeIds: [fx.member, fx.owner], expectedVersion: before.version }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const after = await cardState(fx.card);
    assert.deepEqual(after.assignees, [fx.member, fx.owner].sort());
  });
});
