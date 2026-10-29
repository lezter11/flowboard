import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { EMBEDDED_MIGRATIONS } from '../src/adapters/embedded-migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { getPool } from '../src/adapters/postgres.ts';
import { createApp } from '../src/http/app.ts';

// Real PostgreSQL. Every run uses random ids and emails, so runs never share rows.
const migrationPath = fileURLToPath(new URL('../../../database/migrations/0013_board_description_default_board.sql', import.meta.url));
const sfx = () => crypto.randomBytes(4).toString('hex');
const BASE = 'http://localhost:8787';

interface Who { cookie: string; id: string }

interface Fixture {
  owner: Who;
  manager: Who;      // project manager, board grant on b1 only
  mgrNoGrant: Who;   // project manager with no grant on b1 or b2
  member: Who;       // project member, board grant on b1
  viewer: Who;       // project viewer, board grant on b1
  noGrant: Who;      // project member, no board grant
  stranger: Who;     // no membership anywhere
  revoked: Who;      // membership removed, grant gone
  p1: string;
  p2: string;
  b1: string;
  b2: string;
  bOther: string;    // belongs to p2
  ws: string;
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
  const mgrNoGrant = await mk('mgrnogrant');
  const member = await mk('member');
  const viewer = await mk('viewer');
  const noGrant = await mk('nogrant');
  const stranger = await mk('stranger');
  const revoked = await mk('revoked');

  const ws = `ws_${s}`;
  await pool.query(
    `INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`,
    [ws, owner.id],
  );
  const p1 = `p1_${s}`;
  const p2 = `p2_${s}`;
  await pool.query(
    `INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES
       ($1,$3,'P1',now(),now()), ($2,$3,'P2',now(),now())`,
    [p1, p2, ws],
  );
  const b1 = `b1_${s}`;
  const b2 = `b2_${s}`;
  const bOther = `bo_${s}`;
  await pool.query(
    `INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at) VALUES
       ($1,$4,$5,'B1',now(),now()), ($2,$4,$5,'B2',now(),now()), ($3,$4,$6,'BO',now(),now())`,
    [b1, b2, bOther, ws, p1, p2],
  );
  const membership = (label: string, project: string, userId: string, role: string, status = 'active') =>
    pool.query(
      `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
      [`pm_${label}_${s}`, project, ws, userId, role, status],
    );
  await membership('manager', p1, manager.id, 'manager');
  await membership('mgrnogrant', p1, mgrNoGrant.id, 'manager');
  await membership('member', p1, member.id, 'member');
  await membership('viewer', p1, viewer.id, 'viewer');
  await membership('nogrant', p1, noGrant.id, 'member');
  await membership('revoked', p1, revoked.id, 'member', 'removed');
  await pool.query(
    `INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by)
     SELECT $1, $2, $3, u, $4 FROM unnest($5::text[]) AS u`,
    [b1, p1, ws, owner.id, [manager.id, member.id, viewer.id]],
  );
  return { owner, manager, mgrNoGrant, member, viewer, noGrant, stranger, revoked, p1, p2, b1, b2, bOther, ws };
}

async function readProject(pool: pg.Pool, projectId: string) {
  const res = await pool.query<{ default_board_id: string | null; version: number }>(
    'SELECT default_board_id, version FROM projects WHERE id = $1',
    [projectId],
  );
  return res.rows[0]!;
}

async function readBoard(pool: pg.Pool, boardId: string) {
  const res = await pool.query<{ name: string; description: string | null; snapshot_version: number; archived: boolean }>(
    'SELECT name, description, snapshot_version, archived FROM boards WHERE id = $1',
    [boardId],
  );
  return res.rows[0]!;
}

test('board description: create, read and update, with owner-only edits', async (t) => {
  const pool = getPool();
  const app = createApp(async () => {}, { pool });
  const fx = await setup(pool);

  const req = (method: string, path: string, cookie: string | null, body?: unknown, idempotent = false) =>
    app.request(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(idempotent ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const get = (path: string, cookie: string) => req('GET', path, cookie);
  const patchBoard = (who: Who | null, boardId: string, body: unknown) =>
    req('PATCH', `/api/v1/boards/${boardId}`, who?.cookie ?? null, body, true);
  const patchProject = (who: Who | null, body: unknown) =>
    req('PATCH', `/api/v1/projects/${fx.p1}`, who?.cookie ?? null, body, true);

  await t.test('a new board stores an optional description; without one it reads null', async () => {
    const withDesc = await req('POST', `/api/v1/projects/${fx.p1}/boards`, fx.owner.cookie,
      { name: 'Launch', description: 'Plan for the spring launch.' }, true);
    assert.equal(withDesc.status, 201);
    const created = (await withDesc.json() as any).data;
    assert.equal(created.description, 'Plan for the spring launch.');

    const withoutDesc = await req('POST', `/api/v1/projects/${fx.p1}/boards`, fx.owner.cookie,
      { name: 'Plain' }, true);
    assert.equal(withoutDesc.status, 201);
    assert.equal((await withoutDesc.json() as any).data.description, null);

    const snap = await get(`/api/v1/boards/${created.id}`, fx.owner.cookie);
    assert.equal(((await snap.json()) as any).data.board.description, 'Plan for the spring launch.');
    const list = await get(`/api/v1/projects/${fx.p1}/boards`, fx.owner.cookie);
    const launch = ((await list.json()) as any).data.find((b: any) => b.id === created.id);
    assert.equal(launch.description, 'Plan for the spring launch.');
  });

  await t.test('a description over 2000 characters is refused on create and on update', async () => {
    const tooLong = 'x'.repeat(2001);
    const created = await req('POST', `/api/v1/projects/${fx.p1}/boards`, fx.owner.cookie,
      { name: 'Long', description: tooLong }, true);
    assert.ok(created.status >= 400 && created.status < 500, `create status ${created.status}`);
    const updated = await patchBoard(fx.owner, fx.b1, { description: tooLong, expectedVersion: 1 });
    assert.ok(updated.status >= 400 && updated.status < 500, `update status ${updated.status}`);
  });

  await t.test('owner edits only the description; name and other fields stay as they were', async () => {
    const before = await readBoard(pool, fx.b1);
    const res = await patchBoard(fx.owner, fx.b1, { description: 'Weekly review board', expectedVersion: before.snapshot_version });
    assert.equal(res.status, 200);
    const data = ((await res.json()) as any).data;
    assert.equal(data.description, 'Weekly review board');
    assert.equal(data.name, 'B1');
    const after = await readBoard(pool, fx.b1);
    assert.equal(after.snapshot_version, before.snapshot_version + 1);
  });

  await t.test('owner renames without touching the description', async () => {
    const before = await readBoard(pool, fx.b1);
    const res = await patchBoard(fx.owner, fx.b1, { name: 'B1 renamed', expectedVersion: before.snapshot_version });
    assert.equal(res.status, 200);
    const after = await readBoard(pool, fx.b1);
    assert.equal(after.name, 'B1 renamed');
    assert.equal(after.description, 'Weekly review board');
  });

  await t.test('null clears the description', async () => {
    const before = await readBoard(pool, fx.b1);
    const res = await patchBoard(fx.owner, fx.b1, { description: null, expectedVersion: before.snapshot_version });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).data.description, null);
  });

  await t.test('a PATCH with neither name nor description is refused and writes nothing', async () => {
    const before = await readBoard(pool, fx.b1);
    const res = await patchBoard(fx.owner, fx.b1, { expectedVersion: before.snapshot_version });
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
    assert.deepEqual(await readBoard(pool, fx.b1), before);
  });

  await t.test('a stale expectedVersion is a 409 and writes nothing', async () => {
    const before = await readBoard(pool, fx.b1);
    const res = await patchBoard(fx.owner, fx.b1, { description: 'stale', expectedVersion: before.snapshot_version - 1 });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as any).error.code, 'STALE_VERSION');
    assert.deepEqual(await readBoard(pool, fx.b1), before);
  });

  await t.test('a project manager with a board grant gets 403 and nothing is written', async () => {
    const before = await readBoard(pool, fx.b1);
    const res = await patchBoard(fx.manager, fx.b1, { description: 'manager edit', expectedVersion: before.snapshot_version });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as any).error.code, 'FORBIDDEN');
    assert.deepEqual(await readBoard(pool, fx.b1), before);
  });

  await t.test('a project manager with no grant on the board gets 404 (board boundary first)', async () => {
    const before = await readBoard(pool, fx.b2);
    const res = await patchBoard(fx.mgrNoGrant, fx.b2, { name: 'nope', expectedVersion: before.snapshot_version });
    assert.equal(res.status, 404);
    assert.deepEqual(await readBoard(pool, fx.b2), before);
  });

  await t.test('a member and a viewer, each with a board grant, get 403', async () => {
    const before = await readBoard(pool, fx.b1);
    for (const who of [fx.member, fx.viewer]) {
      const res = await patchBoard(who, fx.b1, { name: 'x', expectedVersion: before.snapshot_version });
      assert.equal(res.status, 403);
    }
    assert.deepEqual(await readBoard(pool, fx.b1), before);
  });

  await t.test('a stranger with no membership gets 404', async () => {
    const before = await readBoard(pool, fx.b1);
    const res = await patchBoard(fx.stranger, fx.b1, { name: 'x', expectedVersion: before.snapshot_version });
    assert.equal(res.status, 404);
    assert.deepEqual(await readBoard(pool, fx.b1), before);
  });

  await t.test('a project manager can still create boards and rename the project', async () => {
    const board = await req('POST', `/api/v1/projects/${fx.p1}/boards`, fx.manager.cookie, { name: 'Made by manager' }, true);
    assert.equal(board.status, 201);
    const project = await readProject(pool, fx.p1);
    const renamed = await patchProject(fx.manager, { name: 'P1 by manager', expectedVersion: project.version });
    assert.equal(renamed.status, 200);
  });
});

test('default landing board: owner-only set, board checks and access-safe reads', async (t) => {
  const pool = getPool();
  const app = createApp(async () => {}, { pool });
  const fx = await setup(pool);

  const send = (method: string, path: string, cookie: string | null, body?: unknown) =>
    app.request(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
        'Idempotency-Key': crypto.randomUUID(),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const setDefault = (who: Who | null, body: unknown) => send('PATCH', `/api/v1/projects/${fx.p1}`, who?.cookie ?? null, body);
  const projectFor = async (who: Who) => {
    const res = await app.request(`${BASE}/api/v1/projects/${fx.p1}`, { headers: { cookie: who.cookie } });
    return { status: res.status, body: (await res.json()) as any };
  };
  const sessionProject = async (who: Who) => {
    const res = await app.request(`${BASE}/api/v1/session`, { headers: { cookie: who.cookie } });
    const body = (await res.json()) as any;
    return body.data.accessibleProjects.find((p: any) => p.id === fx.p1);
  };

  await t.test('owner sets the landing board; the project read and the session both show it', async () => {
    const project = await readProject(pool, fx.p1);
    const res = await setDefault(fx.owner, { defaultBoardId: fx.b1, expectedVersion: project.version });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).data.defaultBoardId, fx.b1);
    assert.equal((await readProject(pool, fx.p1)).default_board_id, fx.b1);
    assert.equal((await projectFor(fx.owner)).body.data.defaultBoardId, fx.b1);
    assert.equal((await sessionProject(fx.owner)).defaultBoardId, fx.b1);
  });

  await t.test('a project manager cannot set the landing board: 403, nothing written', async () => {
    const project = await readProject(pool, fx.p1);
    const res = await setDefault(fx.manager, { defaultBoardId: fx.b2, expectedVersion: project.version });
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as any).error.code, 'FORBIDDEN');
    assert.equal((await readProject(pool, fx.p1)).default_board_id, fx.b1);
  });

  await t.test('a manager request that also sets the landing board is refused whole: no rename either', async () => {
    const project = await readProject(pool, fx.p1);
    const res = await setDefault(fx.manager, { name: 'P1 renamed', defaultBoardId: null, expectedVersion: project.version });
    assert.equal(res.status, 403);
    assert.equal((await readProject(pool, fx.p1)).default_board_id, fx.b1);
    const name = await pool.query<{ name: string }>('SELECT name FROM projects WHERE id = $1', [fx.p1]);
    assert.equal(name.rows[0]!.name, 'P1');
  });

  await t.test('a member, a viewer and a stranger cannot set it', async () => {
    const project = await readProject(pool, fx.p1);
    const member = await setDefault(fx.member, { defaultBoardId: fx.b2, expectedVersion: project.version });
    assert.equal(member.status, 403);
    const viewer = await setDefault(fx.viewer, { defaultBoardId: fx.b2, expectedVersion: project.version });
    assert.equal(viewer.status, 403);
    const stranger = await setDefault(fx.stranger, { defaultBoardId: fx.b2, expectedVersion: project.version });
    assert.equal(stranger.status, 404);
    assert.equal((await readProject(pool, fx.p1)).default_board_id, fx.b1);
  });

  await t.test("a board from another project is 404 and not set", async () => {
    const project = await readProject(pool, fx.p1);
    const res = await setDefault(fx.owner, { defaultBoardId: fx.bOther, expectedVersion: project.version });
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as any).error.message, 'Board not found.');
    assert.equal((await readProject(pool, fx.p1)).default_board_id, fx.b1);
  });

  await t.test('an archived board is refused with 422 BOARD_ARCHIVED', async () => {
    await pool.query('UPDATE boards SET archived = TRUE WHERE id = $1', [fx.b2]);
    const project = await readProject(pool, fx.p1);
    const res = await setDefault(fx.owner, { defaultBoardId: fx.b2, expectedVersion: project.version });
    assert.equal(res.status, 422);
    assert.equal(((await res.json()) as any).error.code, 'BOARD_ARCHIVED');
    await pool.query('UPDATE boards SET archived = FALSE WHERE id = $1', [fx.b2]);
  });

  await t.test('a stale expectedVersion is a 409 and writes nothing', async () => {
    const project = await readProject(pool, fx.p1);
    const res = await setDefault(fx.owner, { defaultBoardId: fx.b2, expectedVersion: project.version + 5 });
    assert.equal(res.status, 409);
    assert.equal((await readProject(pool, fx.p1)).default_board_id, fx.b1);
  });

  await t.test('the database refuses a pointer to a board in another project', async () => {
    await assert.rejects(
      pool.query('UPDATE projects SET default_board_id = $2 WHERE id = $1', [fx.p1, fx.bOther]),
      (err: any) => err.code === '23503',
    );
  });

  await t.test('reads are access-safe: a member with a grant sees the board; without one, null', async () => {
    assert.equal((await projectFor(fx.member)).body.data.defaultBoardId, fx.b1);
    assert.equal((await projectFor(fx.noGrant)).body.data.defaultBoardId, null);
    assert.equal((await sessionProject(fx.noGrant)).defaultBoardId, null);
    // The project list and workspace list use the same rule.
    const list = await app.request(`${BASE}/api/v1/projects`, { headers: { cookie: fx.noGrant.cookie } });
    const row = ((await list.json()) as any).data.find((p: any) => p.id === fx.p1);
    assert.equal(row.defaultBoardId, null);
    const wsList = await app.request(`${BASE}/api/v1/workspaces/${fx.ws}/projects`, { headers: { cookie: fx.noGrant.cookie } });
    const wsRow = ((await wsList.json()) as any).data.find((p: any) => p.id === fx.p1);
    assert.equal(wsRow.defaultBoardId, null);
    const ownerWs = await app.request(`${BASE}/api/v1/workspaces/${fx.ws}/projects`, { headers: { cookie: fx.owner.cookie } });
    const ownerRow = ((await ownerWs.json()) as any).data.find((p: any) => p.id === fx.p1);
    assert.equal(ownerRow.defaultBoardId, fx.b1);
  });

  await t.test('a revoked board grant reads null, and the stored pointer is kept', async () => {
    await pool.query('DELETE FROM board_grants WHERE board_id = $1 AND user_id = $2', [fx.b1, fx.member.id]);
    assert.equal((await projectFor(fx.member)).body.data.defaultBoardId, null);
    assert.equal((await sessionProject(fx.member)).defaultBoardId, null);
    assert.equal((await readProject(pool, fx.p1)).default_board_id, fx.b1);
    await pool.query(
      `INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES ($1,$2,$3,$4,$5)`,
      [fx.b1, fx.p1, fx.ws, fx.member.id, fx.owner.id],
    );
    assert.equal((await projectFor(fx.member)).body.data.defaultBoardId, fx.b1);
  });

  await t.test('a removed member gets no project and no session entry, so no landing board', async () => {
    const res = await app.request(`${BASE}/api/v1/projects/${fx.p1}`, { headers: { cookie: fx.revoked.cookie } });
    assert.equal(res.status, 404);
    assert.equal(await sessionProject(fx.revoked), undefined);
  });

  await t.test('an archived landing board reads null for everyone, and returns when reopened', async () => {
    await pool.query('UPDATE boards SET archived = TRUE WHERE id = $1', [fx.b1]);
    assert.equal((await projectFor(fx.owner)).body.data.defaultBoardId, null);
    assert.equal((await sessionProject(fx.owner)).defaultBoardId, null);
    assert.equal((await readProject(pool, fx.p1)).default_board_id, fx.b1);
    await pool.query('UPDATE boards SET archived = FALSE WHERE id = $1', [fx.b1]);
    assert.equal((await projectFor(fx.owner)).body.data.defaultBoardId, fx.b1);
  });

  await t.test('deleting the landing board clears the pointer; the project is untouched', async () => {
    const boardId = `bdel_${sfx()}`;
    await pool.query(
      `INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at)
       VALUES ($1,$2,$3,'Temp',now(),now())`,
      [boardId, fx.ws, fx.p1],
    );
    await pool.query('UPDATE projects SET default_board_id = $2 WHERE id = $1', [fx.p1, boardId]);
    await pool.query('DELETE FROM boards WHERE id = $1', [boardId]);
    const after = await pool.query<{ id: string; default_board_id: string | null }>(
      'SELECT id, default_board_id FROM projects WHERE id = $1',
      [fx.p1],
    );
    assert.equal(after.rows[0]!.id, fx.p1);
    assert.equal(after.rows[0]!.default_board_id, null);
  });

  await t.test('the owner clears the landing board with null', async () => {
    const project = await readProject(pool, fx.p1);
    const res = await setDefault(fx.owner, { defaultBoardId: null, expectedVersion: project.version });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).data.defaultBoardId, null);
    assert.equal((await readProject(pool, fx.p1)).default_board_id, null);
  });
});

test('migration 0013 is additive, idempotent and embedded byte-for-byte', async () => {
  const pool = getPool();
  await runMigrations(pool);
  const sql = readFileSync(migrationPath, 'utf8');
  const executable = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
  // "ON DELETE SET NULL" is a foreign-key action, not a delete; match destructive statements only.
  assert.doesNotMatch(executable, /\b(DROP|TRUNCATE)\b|\bDELETE\s+FROM\b|\bALTER\s+COLUMN\b/i);
  // Running it a second time must not fail or change anything.
  await pool.query(sql);
  const embedded = EMBEDDED_MIGRATIONS.find((m) => m.version === '0013');
  assert.ok(embedded, 'version 0013 is embedded');
  assert.equal(embedded.sql, sql);
});
