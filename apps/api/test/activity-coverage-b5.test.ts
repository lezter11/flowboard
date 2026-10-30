import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { getPool } from '../src/adapters/postgres.ts';
import { createApp } from '../src/http/app.ts';
import { ACTIVITY_ACTIONS } from '@flowboard/contracts';

// B-5: every column, board, invitation, membership and project-settings write records one
// activity_log row in the same transaction. Real PostgreSQL; random ids per run.
const BASE = 'http://localhost:8787';
const sfx = () => crypto.randomBytes(4).toString('hex');

interface Who { cookie: string; id: string; email: string }

// Project-scope actions: only the owner and managers may read these in the project feed.
const PROJECT_SCOPE_ACTIONS = [
  'invitation_sent', 'invitation_resent', 'invitation_revoked', 'invitation_accepted',
  'member_role_changed', 'member_removed', 'member_reinstated', 'member_left',
  'project_brief_updated', 'project_links_updated',
];

async function setup(pool: pg.Pool) {
  await runMigrations(pool);
  const s = sfx();
  const mk = async (label: string): Promise<Who> => {
    const email = `${label}.${s}@flowboard.example`;
    const { session, user } = await createDevUserAndSession(email, label, pool);
    return { cookie: `flowboard_session=${session.id}`, id: user.id, email };
  };
  const owner = await mk('owner');
  const manager = await mk('manager');          // manager, will get a grant on b1
  const managerNoGrant = await mk('mgrnogrant'); // manager, no board grant anywhere
  const member = await mk('member');            // member, will get a grant on b1
  const memberNoGrant = await mk('nogrant');    // member, no board grant, will leave the project
  const invitee = await mk('invitee');          // invited, accepts, then role changed and removed
  const other = await mk('other');              // invited, then revoked
  const stranger = await mk('stranger');
  const viewer = await mk('viewer');            // project viewer, no grant

  const ws = `ws_${s}`;
  const p1 = `p1_${s}`;
  await pool.query(
    `INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`,
    [ws, owner.id],
  );
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'P1',now(),now())`, [p1, ws]);
  const membership = (label: string, role: string, userId: string) =>
    pool.query(
      `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'active',now(),now())`,
      [`pm_${label}_${s}`, p1, ws, userId, role],
    );
  await membership('manager', 'manager', manager.id);
  await membership('mgrnogrant', 'manager', managerNoGrant.id);
  await membership('member', 'member', member.id);
  await membership('nogrant', 'member', memberNoGrant.id);
  await membership('viewer', 'viewer', viewer.id);
  return { s, ws, p1, owner, manager, managerNoGrant, member, memberNoGrant, invitee, other, stranger, viewer, pool };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

const countActions = async (pool: pg.Pool, projectId: string) => {
  const rows = await pool.query<{ action: string; n: number }>(
    `SELECT action, COUNT(*)::int AS n FROM activity_log WHERE project_id = $1 GROUP BY action`,
    [projectId],
  );
  return Object.fromEntries(rows.rows.map((r) => [r.action, r.n]));
};

const actionCount = async (pool: pg.Pool, projectId: string, action: string) =>
  Number((await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM activity_log WHERE project_id = $1 AND action = $2`,
    [projectId, action],
  )).rows[0]?.n ?? 0);

const boardRow = async (pool: pg.Pool, boardId: string) =>
  (await pool.query<{ structure_version: number; snapshot_version: number }>(
    `SELECT structure_version, snapshot_version FROM boards WHERE id = $1`, [boardId],
  )).rows[0]!;

const projectVersion = async (pool: pg.Pool, projectId: string) =>
  (await pool.query<{ version: number }>(`SELECT version FROM projects WHERE id = $1`, [projectId])).rows[0]!.version;

const memberVersion = async (pool: pg.Pool, projectId: string, userId: string) =>
  (await pool.query<{ version: number }>(
    `SELECT version FROM project_memberships WHERE project_id = $1 AND user_id = $2`, [projectId, userId],
  )).rows[0]!.version;

test('B-5 activity coverage: writes, atomicity, replay, visibility and leaks', async (t) => {
  const pool = getPool();
  const app = createApp(async () => {}, { pool });
  const fx = await setup(pool);
  const { p1, owner, manager, managerNoGrant, member, memberNoGrant, invitee, other, stranger } = fx;

  // Every request carries a fresh Idempotency-Key unless the test passes one.
  const call = (who: Who | null, method: string, path: string, body?: unknown, key?: string) =>
    app.request(`${BASE}${path}`, {
      method,
      headers: {
        ...(who ? { cookie: who.cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(method !== 'GET' ? { 'Idempotency-Key': key ?? crypto.randomUUID() } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : null,
    });
  const json = async (res: Response) => (await res.json()) as any;

  // Shared across the sequential subtests below.
  const ids: Record<string, string> = {};
  const tokens: string[] = [];

  await t.test('flow: each write records exactly one row with the expected action', async () => {
    // Boards: b1 is the working board; b2 is archived and reopened.
    const b1Res = await call(owner, 'POST', `/api/v1/projects/${p1}/boards`, { name: 'Alpha' });
    assert.equal(b1Res.status, 201);
    ids.b1 = (await json(b1Res)).data.id;
    const b2Res = await call(owner, 'POST', `/api/v1/projects/${p1}/boards`, { name: 'Beta' });
    assert.equal(b2Res.status, 201);
    ids.b2 = (await json(b2Res)).data.id;

    let v = await boardRow(pool, ids.b1!);
    const rename = await call(owner, 'PATCH', `/api/v1/boards/${ids.b1}`, { name: 'Alpha 2', expectedVersion: v.snapshot_version });
    assert.equal(rename.status, 200);

    v = await boardRow(pool, ids.b1!);
    const describe = await call(owner, 'PATCH', `/api/v1/boards/${ids.b1}`, { description: 'Secret planning notes', expectedVersion: v.snapshot_version });
    assert.equal(describe.status, 200);

    v = await boardRow(pool, ids.b1!);
    const added = await call(owner, 'POST', `/api/v1/boards/${ids.b1}/columns`, { name: 'Review', color: '#123456', category: 'active', expectedBoardVersion: v.structure_version });
    assert.equal(added.status, 201);
    ids.col = (await json(added)).data.id;

    v = await boardRow(pool, ids.b1!);
    const renamedCol = await call(owner, 'PATCH', `/api/v1/boards/${ids.b1}/columns/${ids.col}`, { name: 'QA', expectedBoardVersion: v.structure_version });
    assert.equal(renamedCol.status, 200);

    v = await boardRow(pool, ids.b1!);
    const recolour = await call(owner, 'PATCH', `/api/v1/boards/${ids.b1}/columns/${ids.col}`, { color: '#654321', expectedBoardVersion: v.structure_version });
    assert.equal(recolour.status, 200);

    v = await boardRow(pool, ids.b1!);
    const recat = await call(owner, 'PATCH', `/api/v1/boards/${ids.b1}/columns/${ids.col}`, { category: 'todo', expectedBoardVersion: v.structure_version });
    assert.equal(recat.status, 200);

    const colIds = (await pool.query<{ id: string }>(
      `SELECT id FROM columns WHERE board_id = $1 ORDER BY position ASC, id ASC`, [ids.b1],
    )).rows.map((r) => r.id);
    v = await boardRow(pool, ids.b1!);
    const reorder = await call(owner, 'POST', `/api/v1/boards/${ids.b1}/columns/reorder`, {
      columnIds: [...colIds].reverse(), expectedBoardVersion: v.structure_version,
    });
    assert.equal(reorder.status, 200);

    v = await boardRow(pool, ids.b1!);
    const del = await call(owner, 'DELETE', `/api/v1/boards/${ids.b1}/columns/${ids.col}?expectedBoardVersion=${v.structure_version}`);
    assert.equal(del.status, 200);

    const archive = await call(owner, 'POST', `/api/v1/boards/${ids.b2}/archive`, {});
    assert.equal(archive.status, 200);
    const reopen = await call(owner, 'POST', `/api/v1/boards/${ids.b2}/reopen`, {});
    assert.equal(reopen.status, 200);

    let pv = await projectVersion(pool, p1);
    const setDefault = await call(owner, 'PATCH', `/api/v1/projects/${p1}`, { expectedVersion: pv, defaultBoardId: ids.b1 });
    assert.equal(setDefault.status, 200);

    pv = await projectVersion(pool, p1);
    const brief = await call(owner, 'PATCH', `/api/v1/projects/${p1}`, {
      expectedVersion: pv, brief: 'Project brief text', links: [{ title: 'Doc', url: 'https://example.com/doc' }],
    });
    assert.equal(brief.status, 200);

    // Invitations: the token is returned once in the response; it must never reach the log.
    const inv1 = await call(owner, 'POST', `/api/v1/projects/${p1}/invitations`, { email: invitee.email, role: 'member' });
    assert.equal(inv1.status, 201);
    const inv1Body = (await json(inv1)).data;
    ids.inv1 = inv1Body.id;
    tokens.push(inv1Body.token);

    // Resend rotates the token, so the original one no longer works. Accept with the new one.
    const resend = await call(owner, 'POST', `/api/v1/projects/${p1}/invitations/${ids.inv1}/resend`, {});
    assert.equal(resend.status, 200);
    inv1Body.token = (await json(resend)).data.token;
    tokens.push(inv1Body.token);

    const inv2 = await call(owner, 'POST', `/api/v1/projects/${p1}/invitations`, { email: other.email, role: 'viewer' });
    assert.equal(inv2.status, 201);
    const inv2Body = (await json(inv2)).data;
    ids.inv2 = inv2Body.id;
    tokens.push(inv2Body.token);
    const revoke = await call(owner, 'POST', `/api/v1/projects/${p1}/invitations/${ids.inv2}/revoke`, {});
    assert.equal(revoke.status, 200);

    const accept = await call(invitee, 'POST', `/api/v1/invitations/accept`, { token: inv1Body.token });
    assert.equal(accept.status, 200);

    const mv = await memberVersion(pool, p1, invitee.id);
    const roleChange = await call(owner, 'PATCH', `/api/v1/projects/${p1}/members/${invitee.id}`, { role: 'viewer', status: 'active', expectedVersion: mv });
    assert.equal(roleChange.status, 200);

    const removeRes = await call(owner, 'DELETE', `/api/v1/projects/${p1}/members/${invitee.id}`);
    assert.equal(removeRes.status, 200);

    const mv2 = await memberVersion(pool, p1, invitee.id);
    const reinstate = await call(owner, 'PATCH', `/api/v1/projects/${p1}/members/${invitee.id}`, { role: 'viewer', status: 'active', expectedVersion: mv2 });
    assert.equal(reinstate.status, 200);

    // The reinstated viewer leaves; memberNoGrant stays a member for the visibility checks below.
    const leave = await call(invitee, 'POST', `/api/v1/projects/${p1}/leave`, {});
    assert.equal(leave.status, 200);

    const counts = await countActions(pool, p1);
    assert.deepEqual(counts, {
      board_created: 2,
      board_renamed: 1,
      board_described: 1,
      board_archived: 1,
      board_reopened: 1,
      column_added: 1,
      column_renamed: 1,
      column_recoloured: 1,
      column_recategorised: 1,
      columns_reordered: 1,
      column_deleted: 1,
      default_board_changed: 1,
      project_brief_updated: 1,
      project_links_updated: 1,
      invitation_sent: 2,
      invitation_resent: 1,
      invitation_revoked: 1,
      invitation_accepted: 1,
      member_role_changed: 1,
      member_removed: 1,
      member_reinstated: 1,
      member_left: 1,
    });
  });

  await t.test('every written action name is in ACTIVITY_ACTIONS', async () => {
    const rows = await pool.query<{ action: string }>(`SELECT DISTINCT action FROM activity_log WHERE project_id = $1`, [p1]);
    for (const { action } of rows.rows) {
      assert.ok((ACTIVITY_ACTIONS as readonly string[]).includes(action), `unknown action ${action}`);
    }
  });

  await t.test('safe_changes carry ids and roles only: no token, no invitee email, no description, no brief text', async () => {
    const rows = await pool.query<{ action: string; safe_changes: unknown }>(
      `SELECT action, safe_changes FROM activity_log WHERE project_id = $1`, [p1],
    );
    const everything = JSON.stringify(rows.rows);
    for (const tok of tokens) assert.ok(!everything.includes(tok), 'a raw invitation token reached the log');
    for (const email of [invitee.email, other.email]) assert.ok(!everything.includes(email), 'an invitee email reached the log');
    assert.ok(!everything.includes('Secret planning notes'), 'a board description reached the log');
    assert.ok(!everything.includes('Project brief text'), 'the project brief text reached the log');
    const sent = rows.rows.find((r) => r.action === 'invitation_sent')!;
    assert.deepEqual(Object.keys(sent.safe_changes as object).sort(), ['invitationId', 'role']);
  });

  await t.test('a failed write records nothing: stale board version and duplicate column name', async () => {
    const before = await countActions(pool, p1);
    const stale = await call(owner, 'PATCH', `/api/v1/boards/${ids.b1}`, { name: 'Should not land', expectedVersion: 0 });
    assert.equal(stale.status, 409);
    const dupVersion = await boardRow(pool, ids.b1!);
    const dup = await call(owner, 'POST', `/api/v1/boards/${ids.b1}/columns`, { name: 'in PROGRESS', color: '#000', category: 'active', expectedBoardVersion: dupVersion.structure_version });
    assert.equal(dup.status, 409);
    // A plain member cannot invite: refused before any write, so no invitation_sent row.
    const badInvite = await call(memberNoGrant, 'POST', `/api/v1/projects/${p1}/invitations`, { email: 'nobody@flowboard.example', role: 'member' });
    assert.equal(badInvite.status, 403);
    assert.deepEqual(await countActions(pool, p1), before);
  });

  await t.test('idempotent replay writes no duplicate row', async () => {
    const v = await boardRow(pool, ids.b1!);
    const key = crypto.randomUUID();
    const body = { name: 'Replay column', color: '#abcdef', category: 'active', expectedBoardVersion: v.structure_version };
    const first = await call(owner, 'POST', `/api/v1/boards/${ids.b1}/columns`, body, key);
    assert.equal(first.status, 201);
    const countAfterFirst = await actionCount(pool, p1, 'column_added');
    const replay = await call(owner, 'POST', `/api/v1/boards/${ids.b1}/columns`, body, key);
    assert.ok(replay.status === 200 || replay.status === 201);
    assert.equal(await actionCount(pool, p1, 'column_added'), countAfterFirst, 'replay wrote another column_added row');
  });

  await t.test('visibility: owner reads board and project rows in the project feed', async () => {
    const res = await call(owner, 'GET', `/api/v1/projects/${p1}/activity?limit=100`);
    assert.equal(res.status, 200);
    const actions = (await json(res)).data.map((r: any) => r.action);
    assert.ok(actions.includes('board_created'));
    assert.ok(actions.includes('invitation_sent'));
    assert.ok(actions.includes('member_removed'));
  });

  await t.test('visibility: manager without a grant sees project rows and no board rows', async () => {
    const res = await call(managerNoGrant, 'GET', `/api/v1/projects/${p1}/activity?limit=100`);
    assert.equal(res.status, 200);
    const rows = (await json(res)).data as any[];
    const actions = rows.map((r) => r.action);
    assert.ok(actions.includes('invitation_sent'), 'manager should see invitation events');
    assert.ok(actions.includes('member_removed'), 'manager should see member events');
    for (const r of rows) {
      assert.ok(!r.action.startsWith('board_') && !r.action.startsWith('column_') && r.action !== 'columns_reordered' && r.action !== 'default_board_changed',
        `board-scoped ${r.action} leaked to a manager with no grant`);
    }
  });

  await t.test('visibility: manager with a grant on b1 sees b1 rows but not b2 rows', async () => {
    await pool.query(
      `INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [ids.b1, p1, fx.ws, manager.id, owner.id],
    );
    const res = await call(manager, 'GET', `/api/v1/projects/${p1}/activity?limit=100`);
    assert.equal(res.status, 200);
    const rows = (await json(res)).data as any[];
    const b1Rows = rows.filter((r) => r.action === 'column_added' || r.action === 'board_renamed');
    assert.ok(b1Rows.length >= 2, 'grant holder should see b1 board rows');
    const b2Created = await pool.query(
      `SELECT id FROM activity_log WHERE project_id = $1 AND action = 'board_created' AND board_id = $2`, [p1, ids.b2],
    );
    const b2Ids = new Set(b2Created.rows.map((r) => r.id));
    assert.ok(!rows.some((r) => b2Ids.has(r.id)), 'b2 board row leaked to a manager without a grant on b2');
  });

  await t.test('visibility: member with a grant gets 403 on the project feed and sees b1 rows, no project rows, in overview', async () => {
    await pool.query(
      `INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [ids.b1, p1, fx.ws, member.id, owner.id],
    );
    const feed = await call(member, 'GET', `/api/v1/projects/${p1}/activity`);
    assert.equal(feed.status, 403);

    const ov = await call(member, 'GET', `/api/v1/projects/${p1}/overview`);
    assert.equal(ov.status, 200);
    const recent = (await json(ov)).data.recentActivity as Array<{ action: string }>;
    assert.ok(recent.length > 0, 'grant holder should see b1 rows in overview');
    for (const r of recent) assert.ok(!PROJECT_SCOPE_ACTIONS.includes(r.action), `project row ${r.action} leaked to overview`);
  });

  await t.test('visibility: member with no grant sees nothing; stranger gets 404', async () => {
    const ov = await call(memberNoGrant, 'GET', `/api/v1/projects/${p1}/overview`);
    assert.equal((await json(ov)).data.recentActivity.length, 0);
    const feed = await call(memberNoGrant, 'GET', `/api/v1/projects/${p1}/activity`);
    assert.equal(feed.status, 403);
    assert.equal((await call(stranger, 'GET', `/api/v1/projects/${p1}/activity`)).status, 404);
    assert.equal((await call(stranger, 'GET', `/api/v1/projects/${p1}/overview`)).status, 404);
  });

  await t.test('overview (B-6): owner and manager see project rows; member, viewer and no-grant member do not', async () => {
    const projectRows = async (who: Who) => {
      const res = await call(who, 'GET', `/api/v1/projects/${p1}/overview`);
      assert.equal(res.status, 200);
      const recent = (await json(res)).data.recentActivity as Array<{ action: string }>;
      return recent.filter((r) => PROJECT_SCOPE_ACTIONS.includes(r.action)).map((r) => r.action);
    };
    assert.ok((await projectRows(owner)).includes('invitation_sent'), 'owner should see project rows');
    assert.ok((await projectRows(manager)).includes('member_removed'), 'manager with grant should see project rows');
    assert.ok((await projectRows(managerNoGrant)).length > 0, 'manager without grant should see project rows');
    assert.equal((await projectRows(member)).length, 0, 'member must not see project rows');
    assert.equal((await projectRows(fx.viewer)).length, 0, 'viewer must not see project rows');
    assert.equal((await projectRows(memberNoGrant)).length, 0, 'no-grant member must not see project rows');
    assert.equal((await call(fx.viewer, 'GET', `/api/v1/projects/${p1}/activity`)).status, 403);
  });

  await t.test('overview (B-6): no token or invitee email in any overview body', async () => {
    for (const who of [owner, manager, managerNoGrant]) {
      const text = await (await call(who, 'GET', `/api/v1/projects/${p1}/overview`)).text();
      for (const tok of tokens) assert.ok(!text.includes(tok), 'token leaked into overview');
      for (const email of [invitee.email, other.email]) assert.ok(!text.includes(email), 'email leaked into overview');
    }
  });

  await t.test('leak: the owner feed JSON never contains a token or an invitee email', async () => {
    const res = await call(owner, 'GET', `/api/v1/projects/${p1}/activity?limit=100`);
    const text = await res.text();
    for (const tok of tokens) assert.ok(!text.includes(tok), 'token leaked through the activity feed');
    for (const email of [invitee.email, other.email]) assert.ok(!text.includes(email), 'email leaked through the activity feed');
  });

  await t.test('removing a member also revokes their pending invitation and logs that revoke once', async () => {
    const invId = `inv_side_${fx.s}`;
    await pool.query(
      `INSERT INTO project_invitations (id,project_id,workspace_id,email,role,token_hash,invited_by,status,expires_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'viewer','hash_side_effect',$5,'pending',now() + interval '7 days',now(),now())`,
      [invId, p1, fx.ws, memberNoGrant.email, owner.id],
    );
    const mv = await memberVersion(pool, p1, memberNoGrant.id);
    const before = await actionCount(pool, p1, 'invitation_revoked');
    const res = await call(owner, 'DELETE', `/api/v1/projects/${p1}/members/${memberNoGrant.id}`);
    assert.equal(res.status, 200, `remove failed, version ${mv}`);
    assert.equal(await actionCount(pool, p1, 'invitation_revoked'), before + 1);
    const row = await pool.query<{ safe_changes: any }>(
      `SELECT safe_changes FROM activity_log WHERE project_id = $1 AND action = 'invitation_revoked' ORDER BY created_at DESC, id DESC LIMIT 1`,
      [p1],
    );
    assert.deepEqual(row.rows[0]!.safe_changes, { invitationId: invId, role: 'viewer', reason: 'member_removed' });
  });
});
