import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { EMBEDDED_MIGRATIONS } from '../src/adapters/embedded-migrations.ts';
import { getWorkspaceToday } from '../src/adapters/boards.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { getPool } from '../src/adapters/postgres.ts';
import { createApp } from '../src/http/app.ts';

// Real PostgreSQL. Every run uses random ids and emails, so runs never share rows.
const migrationPath = fileURLToPath(new URL('../../../database/migrations/0014_project_brief_links.sql', import.meta.url));
const sfx = () => crypto.randomBytes(4).toString('hex');
const BASE = 'http://localhost:8787';
const TODAY = getWorkspaceToday('UTC');
const day = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

interface Who { cookie: string; id: string }

interface Fixture {
  owner: Who;
  manager: Who;   // project manager, grant on b1
  member: Who;    // project member, grant on b1
  viewer: Who;    // project viewer, grant on b1
  noGrant: Who;   // project member, no board grant anywhere
  stranger: Who;  // no membership
  removed: Who;   // membership removed
  ws: string;
  p1: string;
  b1: string;     // readable by manager, member, viewer
  b2: string;     // readable by the owner only
  bArch: string;  // archived; readable by nobody but still excluded for everyone
  c1: string; c2: string; c3: string; c4: string; c5: string;
  d1: string; d2: string; d3: string;
  cArch: string;
  colTodo1: string; colActive1: string; colDone1: string;
  colTodo2: string; colActive2: string; colDone2: string;
}

async function setup(pool: pg.Pool): Promise<Fixture> {
  await runMigrations(pool);
  const s = sfx();
  const mk = async (label: string): Promise<Who> => {
    const { session, user } = await createDevUserAndSession(`${label}.${s}@flowboard.example`, label, pool);
    return { cookie: `flowboard_session=${session.id}`, id: user.id };
  };
  const owner = await mk('owner');
  const manager = await mk('manager');
  const member = await mk('member');
  const viewer = await mk('viewer');
  const noGrant = await mk('nogrant');
  const stranger = await mk('stranger');
  const removed = await mk('removed');

  const ws = `ws_${s}`;
  await pool.query(
    `INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`,
    [ws, owner.id],
  );
  const p1 = `p1_${s}`;
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'P1',now(),now())`, [p1, ws]);

  const b1 = `b1_${s}`;
  const b2 = `b2_${s}`;
  const bArch = `ba_${s}`;
  await pool.query(
    `INSERT INTO boards (id,workspace_id,project_id,name,archived,created_at,updated_at) VALUES
       ($1,$4,$5,'Alpha',FALSE,now(),now()), ($2,$4,$5,'Beta',FALSE,now(),now()), ($3,$4,$5,'Old',TRUE,now(),now())`,
    [b1, b2, bArch, ws, p1],
  );

  const colTodo1 = `ct1_${s}`; const colActive1 = `ca1_${s}`; const colDone1 = `cd1_${s}`;
  const colTodo2 = `ct2_${s}`; const colActive2 = `ca2_${s}`; const colDone2 = `cd2_${s}`;
  const col = (id: string, board: string, name: string, category: string, position: number) =>
    pool.query(
      `INSERT INTO columns (id,workspace_id,project_id,board_id,name,color,category,position,version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'#000',$6,$7,1,now(),now())`,
      [id, ws, p1, board, name, category, position],
    );
  await col(colTodo1, b1, 'Todo', 'todo', 0);
  await col(colActive1, b1, 'Doing', 'active', 1);
  await col(colDone1, b1, 'Done', 'done', 2);
  await col(colTodo2, b2, 'Todo', 'todo', 0);
  await col(colActive2, b2, 'Doing', 'active', 1);
  await col(colDone2, b2, 'Done', 'done', 2);
  const colArch = `ca_${s}`;
  await col(colArch, bArch, 'Doing', 'active', 0);

  const card = async (id: string, board: string, column: string, due: string | null, state = 'active') => {
    await pool.query(
      `INSERT INTO cards (id,workspace_id,project_id,board_id,column_id,title,priority,due_date,position,version,state,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$1,'none',$6,1000,1,$7,now(),now())`,
      [id, ws, p1, board, column, due, state],
    );
  };
  const c1 = `c1_${s}`; const c2 = `c2_${s}`; const c3 = `c3_${s}`; const c4 = `c4_${s}`; const c5 = `c5_${s}`;
  const d1 = `d1_${s}`; const d2 = `d2_${s}`; const d3 = `d3_${s}`;
  const cArch = `ka_${s}`;
  await card(c1, b1, colActive1, day(-2));           // overdue, assigned to member
  await card(c2, b1, colTodo1, day(3));              // due soon, unassigned
  await card(c3, b1, colDone1, day(-5));             // done, not overdue, assigned to member
  await card(c4, b1, colActive1, day(10));           // beyond seven days, assigned to manager
  await card(c5, b1, colActive1, day(-9), 'trashed'); // trashed: excluded everywhere
  await card(d1, b2, colActive2, day(-1));           // overdue, assigned to member, owner-only board
  await card(d2, b2, colTodo2, null);                // unassigned, owner-only board
  await card(d3, b2, colTodo2, day(0));              // due today, owner-only board, unassigned
  await card(cArch, bArch, colArch, day(-30));       // archived board: excluded for everyone

  const assign = (card: string, user: string) =>
    pool.query(
      `INSERT INTO card_assignees (card_id,user_id,workspace_id,project_id,created_at) VALUES ($1,$2,$3,$4,now())`,
      [card, user, ws, p1],
    );
  await assign(c1, member.id);
  await assign(c3, member.id);
  await assign(c4, manager.id);
  await assign(d1, member.id);

  const membership = (label: string, role: string, userId: string, status = 'active') =>
    pool.query(
      `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
      [`pm_${label}_${s}`, p1, ws, userId, role, status],
    );
  await membership('manager', 'manager', manager.id);
  await membership('member', 'member', member.id);
  await membership('viewer', 'viewer', viewer.id);
  await membership('nogrant', 'member', noGrant.id);
  await membership('removed', 'member', removed.id, 'removed');

  await pool.query(
    `INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by)
     SELECT $1, $2, $3, u, $4 FROM unnest($5::text[]) AS u`,
    [b1, p1, ws, owner.id, [manager.id, member.id, viewer.id]],
  );

  // Activity: one board-scoped row on b1, one on b2, one project-scoped audit row, one on archived b.
  const act = (id: string, board: string | null, scope: string, card: string | null, actor: string, action: string, at: string) =>
    pool.query(
      `INSERT INTO activity_log (id,workspace_id,project_id,card_id,actor_id,action,safe_changes,created_at,board_id,visibility_scope)
       VALUES ($1,$2,$3,$4,$5,$6,'{}'::jsonb,$7::timestamptz,$8,$9)`,
      [id, ws, p1, card, actor, action, at, board, scope],
    );
  await act(`a1_${s}`, b1, 'board', c1, member.id, 'card.updated', '2026-10-28T10:00:00Z');
  await act(`a2_${s}`, b2, 'board', d1, member.id, 'card.updated', '2026-10-28T11:00:00Z');
  await act(`a3_${s}`, null, 'project', null, owner.id, 'member.role_changed', '2026-10-28T12:00:00Z');

  return {
    owner, manager, member, viewer, noGrant, stranger, removed, ws, p1, b1, b2, bArch,
    c1, c2, c3, c4, c5, d1, d2, d3, cArch,
    colTodo1, colActive1, colDone1, colTodo2, colActive2, colDone2,
  };
}

const jsonOf = async (res: Response) => (await res.json()) as any;

test('project overview: counts over readable boards, privacy, and the snapshot rules', async (t) => {
  const pool = getPool();
  const app = createApp(async () => {}, { pool });
  const fx = await setup(pool);
  const get = (who: Who | null, path: string) =>
    app.request(`${BASE}${path}`, { headers: who ? { cookie: who.cookie } : {} });
  const overview = (who: Who | null) => get(who, `/api/v1/projects/${fx.p1}/overview`);

  await t.test('owner sees every non-archived board: totals match the fixture by hand', async () => {
    const res = await overview(fx.owner);
    assert.equal(res.status, 200);
    const data = (await jsonOf(res)).data;
    assert.equal(data.asOfDate, TODAY);
    assert.equal(data.readableBoardCount, 2);
    // Active, non-trashed cards on b1 and b2: c1 c2 c3 c4 d1 d2 d3 (archived b and trashed c5 excluded).
    assert.equal(data.cards.active, 7);
    assert.deepEqual(data.cards.byCategory, { todo: 3, active: 3, done: 1 });
    assert.equal(data.cards.overdue, 2);        // c1 (-2), d1 (-1)
    assert.equal(data.cards.dueSoon, 2);        // c2 (+3), d3 (today); c4 (+10) is outside seven days
    assert.equal(data.cards.unassignedOpen, 3); // c2, d2, d3
    assert.deepEqual(data.assignees, [
      { userId: fx.member.id, displayName: 'member', avatarUrl: null, openCount: 2 }, // c1, d1 (c3 is done)
      { userId: fx.manager.id, displayName: 'manager', avatarUrl: null, openCount: 1 }, // c4
    ]);
  });

  await t.test('recent activity: board rows on readable boards, and project rows for the owner (B-6)', async () => {
    const data = (await jsonOf(await overview(fx.owner))).data;
    const cardIds = data.recentActivity.map((r: any) => r.cardId);
    // Newest first: the project-scoped row (12:00, no card) then d1 (11:00) then c1 (10:00).
    assert.deepEqual(cardIds, [null, fx.d1, fx.c1]);
    assert.equal(data.recentActivity[0].action, 'member.role_changed');
    assert.equal(data.recentActivity[1].actor.displayName, 'member');
  });

  await t.test('a manager or member with a grant sees only that board: no counts from b2', async () => {
    const data = (await jsonOf(await overview(fx.member))).data;
    assert.equal(data.readableBoardCount, 1);
    assert.equal(data.cards.active, 4);                 // c1 c2 c3 c4 (c3 is done but still a card)
    assert.deepEqual(data.cards.byCategory, { todo: 1, active: 2, done: 1 });
    assert.equal(data.cards.overdue, 1);                // c1 only; d1 is on b2
    assert.equal(data.cards.dueSoon, 1);                // c2
    assert.equal(data.cards.unassignedOpen, 1);         // c2 only; d2 and d3 are on b2
    // Both have one open card, so their order is a tie; compare as a set.
    assert.deepEqual(
      data.assignees.map((a: any) => `${a.displayName}:${a.openCount}`).sort(),
      ['manager:1', 'member:1'],
    );
    assert.deepEqual(data.recentActivity.map((r: any) => r.cardId), [fx.c1]);
  });

  await t.test('a viewer with a grant sees the same board-only view as a member', async () => {
    const data = (await jsonOf(await overview(fx.viewer))).data;
    assert.equal(data.readableBoardCount, 1);
    assert.equal(data.cards.overdue, 1);
  });

  await t.test('a member with no board grant gets empty counts and must not see b1 or b2 at all', async () => {
    const res = await overview(fx.noGrant);
    assert.equal(res.status, 200);
    const text = await res.text();
    const data = JSON.parse(text).data;
    assert.equal(data.readableBoardCount, 0);
    assert.equal(data.cards.active, 0);
    assert.deepEqual(data.cards.byCategory, { todo: 0, active: 0, done: 0 });
    assert.equal(data.cards.overdue, 0);
    assert.equal(data.cards.dueSoon, 0);
    assert.equal(data.cards.unassignedOpen, 0);
    assert.deepEqual(data.assignees, []);
    assert.deepEqual(data.recentActivity, []);
    // No id, name or card title of any board the caller cannot read appears in the body.
    for (const hidden of [fx.b1, fx.b2, fx.bArch, fx.c1, fx.d1, fx.d2, 'Alpha', 'Beta', 'Old']) {
      assert.ok(!text.includes(hidden), `response leaked ${hidden}`);
    }
  });

  await t.test('stranger and removed member get 404', async () => {
    assert.equal((await overview(fx.stranger)).status, 404);
    assert.equal((await overview(fx.removed)).status, 404);
    assert.equal((await overview(null)).status, 401);
  });

  await t.test('a revoked board grant drops that board from the member view at once', async () => {
    await pool.query('DELETE FROM board_grants WHERE board_id = $1 AND user_id = $2', [fx.b1, fx.member.id]);
    const data = (await jsonOf(await overview(fx.member))).data;
    assert.equal(data.readableBoardCount, 0);
    assert.equal(data.cards.active, 0);
    await pool.query(
      `INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES ($1,$2,$3,$4,$5)`,
      [fx.b1, fx.p1, fx.ws, fx.member.id, fx.owner.id],
    );
  });

  await t.test('the archived board is excluded for the owner too', async () => {
    const data = (await jsonOf(await overview(fx.owner))).data;
    assert.equal(data.cards.overdue, 2); // the archived board's card (-30) is not counted
  });
});

test('project brief and links: manager edit, https-only, whole-list replace, read rules', async (t) => {
  const pool = getPool();
  const app = createApp(async () => {}, { pool });
  const fx = await setup(pool);
  const version = async () => (await pool.query<{ version: number }>('SELECT version FROM projects WHERE id = $1', [fx.p1])).rows[0]!.version;
  const patch = (who: Who | null, body: unknown) =>
    app.request(`${BASE}/api/v1/projects/${fx.p1}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(who ? { cookie: who.cookie } : {}),
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
  const read = (who: Who) => app.request(`${BASE}/api/v1/projects/${fx.p1}`, { headers: { cookie: who.cookie } });
  const twoLinks = [
    { title: 'Spec', url: 'https://docs.example.com/spec' },
    { title: 'Design', url: 'https://design.example.com/board?id=7#top' },
  ];

  await t.test('manager sets the brief and links; the response carries them in order', async () => {
    const res = await patch(fx.manager, { brief: 'Ship the spring board.', links: twoLinks, expectedVersion: await version() });
    assert.equal(res.status, 200);
    const data = (await jsonOf(res)).data;
    assert.equal(data.brief, 'Ship the spring board.');
    assert.deepEqual(data.links.map((l: any) => [l.title, l.position]), [['Spec', 0], ['Design', 1]]);
    assert.ok(data.links.every((l: any) => typeof l.id === 'string' && l.id.length > 0));
  });

  await t.test('members, viewers and strangers can read the brief and links; strangers cannot read the project', async () => {
    for (const who of [fx.member, fx.viewer, fx.noGrant]) {
      const data = (await jsonOf(await read(who))).data;
      assert.equal(data.brief, 'Ship the spring board.');
      assert.equal(data.links.length, 2);
    }
    assert.equal((await read(fx.stranger)).status, 404);
  });

  await t.test('a member or viewer cannot edit the brief or links: 403, nothing written', async () => {
    const before = await version();
    assert.equal((await patch(fx.member, { brief: 'member edit', expectedVersion: before })).status, 403);
    assert.equal((await patch(fx.viewer, { links: [], expectedVersion: before })).status, 403);
    assert.equal((await version()), before);
    const data = (await jsonOf(await read(fx.manager))).data;
    assert.equal(data.brief, 'Ship the spring board.');
  });

  await t.test('a stranger gets 404', async () => {
    assert.equal((await patch(fx.stranger, { brief: 'x', expectedVersion: await version() })).status, 404);
  });

  await t.test('brief over 5000 characters is refused', async () => {
    const res = await patch(fx.manager, { brief: 'x'.repeat(5001), expectedVersion: await version() });
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
  });

  await t.test('more than 10 links is refused', async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ title: `L${i}`, url: `https://a.example.com/${i}` }));
    const res = await patch(fx.manager, { links: eleven, expectedVersion: await version() });
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
  });

  await t.test('non-https, credentials and other schemes are refused, and nothing is written', async () => {
    const before = (await jsonOf(await read(fx.manager))).data.links;
    const bad = [
      'http://plain.example.com/',
      'javascript:alert(1)',
      'ftp://files.example.com/x',
      'https://user:secret@host.example.com/',
      'https://user@host.example.com/',
      'https://host.example.com/has space',
      'not a url',
      `https://${'a'.repeat(2000)}.example.com/`,
    ];
    for (const url of bad) {
      const res = await patch(fx.manager, { links: [{ title: 'Bad', url }], expectedVersion: await version() });
      assert.ok(res.status >= 400 && res.status < 500, `${url} accepted with ${res.status}`);
    }
    assert.deepEqual((await jsonOf(await read(fx.manager))).data.links, before);
  });

  await t.test('the database refuses a non-https link even if the API is bypassed', async () => {
    await assert.rejects(
      pool.query(
        `INSERT INTO project_links (id,workspace_id,project_id,title,url,position,created_at,updated_at)
         VALUES ($1,$2,$3,'x','http://bad.example.com',9,now(),now())`,
        [`plk_bad_${sfx()}`, fx.ws, fx.p1],
      ),
      (err: any) => err.code === '23514',
    );
  });

  await t.test('links replace the whole list; an empty list removes them all', async () => {
    const replaced = await patch(fx.manager, { links: [{ title: 'Only', url: 'https://only.example.com' }], expectedVersion: await version() });
    assert.equal(replaced.status, 200);
    assert.deepEqual((await jsonOf(replaced)).data.links.map((l: any) => l.title), ['Only']);
    const cleared = await patch(fx.manager, { links: [], expectedVersion: await version() });
    assert.equal(cleared.status, 200);
    assert.deepEqual((await jsonOf(cleared)).data.links, []);
  });

  await t.test('a stale expectedVersion is 409 and changes nothing', async () => {
    const current = await version();
    const res = await patch(fx.manager, { brief: 'stale', expectedVersion: current + 3 });
    assert.equal(res.status, 409);
    assert.equal((await jsonOf(await read(fx.manager))).data.brief, 'Ship the spring board.');
  });

  await t.test('an empty PATCH is refused', async () => {
    const res = await patch(fx.manager, { expectedVersion: await version() });
    assert.ok(res.status >= 400 && res.status < 500);
  });
});

test('migration 0014 is additive, idempotent and embedded byte-for-byte', async () => {
  const pool = getPool();
  await runMigrations(pool);
  const sql = readFileSync(migrationPath, 'utf8');
  const executable = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
  assert.doesNotMatch(executable, /\b(DROP|TRUNCATE)\b|\bDELETE\s+FROM\b|\bALTER\s+COLUMN\b/i);
  await pool.query(sql);
  const embedded = EMBEDDED_MIGRATIONS.find((m) => m.version === '0014');
  assert.ok(embedded, 'version 0014 is embedded');
  assert.equal(embedded.sql, sql);
});
