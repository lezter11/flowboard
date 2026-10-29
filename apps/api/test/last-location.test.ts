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
const migrationPath = fileURLToPath(new URL('../../../database/migrations/0012_user_last_location.sql', import.meta.url));
const sfx = () => crypto.randomBytes(4).toString('hex');

interface Fixture {
  owner: { cookie: string; id: string };
  member: { cookie: string; id: string };      // active member, board grant on b1 only
  noGrant: { cookie: string; id: string };     // active member, no board grant
  outsider: { cookie: string; id: string };    // no membership anywhere
  otherProject: { cookie: string; id: string }; // member of p2 only
  revoked: { cookie: string; id: string };     // membership removed, grant gone
  p1: string;
  b1: string;
  b2: string;
  p2: string;
  bOther: string;
  pArchived: string;
}

async function setup(pool: pg.Pool): Promise<Fixture> {
  await runMigrations(pool);
  const s = sfx();
  const mk = async (label: string) => {
    const { session, user } = await createDevUserAndSession(`${label}.${s}@flowboard.example`, label, pool);
    return { cookie: `flowboard_session=${session.id}`, id: user.id };
  };
  const owner = await mk('owner');
  const member = await mk('member');
  const noGrant = await mk('nogrant');
  const outsider = await mk('outsider');
  const otherProject = await mk('otherproj');
  const revoked = await mk('revoked');

  const ws = `ws_${s}`;
  await pool.query(
    `INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`,
    [ws, owner.id],
  );
  const p1 = `p1_${s}`;
  const p2 = `p2_${s}`;
  const pArchived = `pa_${s}`;
  await pool.query(
    `INSERT INTO projects (id,workspace_id,name,archived,created_at,updated_at) VALUES
       ($1,$4,'P1',FALSE,now(),now()), ($2,$4,'P2',FALSE,now(),now()), ($3,$4,'Old',FALSE,now(),now())`,
    [p1, p2, pArchived, ws],
  );
  const b1 = `b1_${s}`;
  const b2 = `b2_${s}`;
  const bOther = `bo_${s}`;
  await pool.query(
    `INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at) VALUES
       ($1,$4,$5,'B1',now(),now()), ($2,$4,$5,'B2',now(),now()), ($3,$4,$6,'BO',now(),now())`,
    [b1, b2, bOther, ws, p1, p2],
  );
  const membership = (id: string, project: string, userId: string, status: string) =>
    pool.query(
      `INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at)
       VALUES ($1,$2,$3,$4,'member',$5,now(),now())`,
      [`pm_${id}_${s}`, project, ws, userId, status],
    );
  await membership('member', p1, member.id, 'active');
  await membership('nogrant', p1, noGrant.id, 'active');
  await membership('other', p2, otherProject.id, 'active');
  await membership('revoked', p1, revoked.id, 'removed');
  await pool.query(
    `INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES ($1,$2,$3,$4,$5)`,
    [b1, p1, ws, member.id, owner.id],
  );
  return { owner, member, noGrant, outsider, otherProject, revoked, p1, b1, b2, p2, bOther, pArchived };
}

async function storedLocation(pool: pg.Pool, userId: string) {
  const res = await pool.query<{ last_project_id: string | null; last_board_id: string | null }>(
    'SELECT last_project_id, last_board_id FROM users WHERE id = $1',
    [userId],
  );
  return res.rows[0];
}

test('last location: write rules, read re-check and the no-op write', async (t) => {
  const pool = getPool();
  const app = createApp(async () => {}, { pool });
  const fx = await setup(pool);
  const put = (cookie: string | null, body: unknown) =>
    app.request('http://localhost:8787/api/v1/session/last-location', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
  const session = (cookie: string) => app.request('http://localhost:8787/api/v1/session', { headers: { cookie } });

  await t.test('owner sets project and board; GET /session returns them', async () => {
    const res = await put(fx.owner.cookie, { projectId: fx.p1, boardId: fx.b2 });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { data: { projectId: fx.p1, boardId: fx.b2 } });
    const body = await (await session(fx.owner.cookie)).json() as any;
    assert.deepEqual(body.data.lastLocation, { projectId: fx.p1, boardId: fx.b2 });
  });

  await t.test('omitted boardId stores a project-only location', async () => {
    const res = await put(fx.owner.cookie, { projectId: fx.p1 });
    assert.equal(res.status, 200);
    const body = await (await session(fx.owner.cookie)).json() as any;
    assert.deepEqual(body.data.lastLocation, { projectId: fx.p1, boardId: null });
  });

  await t.test('an unchanged PUT writes no row version (xmin is stable)', async () => {
    await put(fx.owner.cookie, { projectId: fx.p1, boardId: fx.b1 });
    const before = await pool.query<{ xmin: string }>('SELECT xmin::text FROM users WHERE id = $1', [fx.owner.id]);
    const again = await put(fx.owner.cookie, { projectId: fx.p1, boardId: fx.b1 });
    assert.equal(again.status, 200);
    const after = await pool.query<{ xmin: string }>('SELECT xmin::text FROM users WHERE id = $1', [fx.owner.id]);
    assert.equal(after.rows[0]!.xmin, before.rows[0]!.xmin);
  });

  await t.test('a member with a board grant may set that board', async () => {
    const res = await put(fx.member.cookie, { projectId: fx.p1, boardId: fx.b1 });
    assert.equal(res.status, 200);
  });

  await t.test('a member without a board grant cannot set that board; nothing is written', async () => {
    await put(fx.noGrant.cookie, { projectId: fx.p1 });
    const beforeRow = await storedLocation(pool, fx.noGrant.id);
    const res = await put(fx.noGrant.cookie, { projectId: fx.p1, boardId: fx.b2 });
    assert.equal(res.status, 404);
    assert.equal((await res.json() as any).error.code, 'NOT_FOUND');
    assert.deepEqual(await storedLocation(pool, fx.noGrant.id), beforeRow);
  });

  await t.test('a user with no membership gets 404 and no write', async () => {
    const before = await storedLocation(pool, fx.outsider.id);
    const res = await put(fx.outsider.cookie, { projectId: fx.p1 });
    assert.equal(res.status, 404);
    assert.equal((await res.json() as any).error.code, 'NOT_FOUND');
    assert.deepEqual(await storedLocation(pool, fx.outsider.id), before);
  });

  await t.test("another project's member cannot set this project; nothing is written", async () => {
    const before = await storedLocation(pool, fx.otherProject.id);
    const res = await put(fx.otherProject.cookie, { projectId: fx.p1 });
    assert.equal(res.status, 404);
    assert.deepEqual(await storedLocation(pool, fx.otherProject.id), before);
    // Their own project works for a project-only location. Their project has no grant on bOther, so a board fails.
    assert.equal((await put(fx.otherProject.cookie, { projectId: fx.p2 })).status, 200);
    assert.equal((await put(fx.otherProject.cookie, { projectId: fx.p2, boardId: fx.bOther })).status, 404);
  });

  await t.test('a board from another project is rejected even for the owner', async () => {
    const res = await put(fx.owner.cookie, { projectId: fx.p1, boardId: fx.bOther });
    assert.equal(res.status, 404);
    assert.equal((await res.json() as any).error.message, 'Board not found.');
  });

  await t.test('a request with no session is 401', async () => {
    assert.equal((await put(null, { projectId: fx.p1 })).status, 401);
  });

  await t.test('unknown fields are refused and nothing is written', async () => {
    const before = await storedLocation(pool, fx.owner.id);
    const res = await put(fx.owner.cookie, { projectId: fx.p1, role: 'owner' });
    assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
    assert.deepEqual(await storedLocation(pool, fx.owner.id), before);
  });

  await t.test('a revoked member reads null, never the stale id', async () => {
    await pool.query(
      `UPDATE users SET last_project_id = $2, last_board_id = NULL WHERE id = $1`,
      [fx.revoked.id, fx.p1],
    );
    const body = await (await session(fx.revoked.cookie)).json() as any;
    assert.equal(body.data.lastLocation, null);
    // The stored pointer is left alone; only the read is withheld.
    assert.equal((await storedLocation(pool, fx.revoked.id))!.last_project_id, fx.p1);
  });

  await t.test('a revoked board grant reads null for the whole location', async () => {
    await put(fx.member.cookie, { projectId: fx.p1, boardId: fx.b1 });
    await pool.query('DELETE FROM board_grants WHERE board_id = $1 AND user_id = $2', [fx.b1, fx.member.id]);
    const body = await (await session(fx.member.cookie)).json() as any;
    assert.equal(body.data.lastLocation, null);
    // Restore the grant for later subtests.
    await pool.query(
      `INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by)
       SELECT b.id, b.project_id, b.workspace_id, $2, $3 FROM boards b WHERE b.id = $1`,
      [fx.b1, fx.member.id, fx.owner.id],
    );
  });

  await t.test('an archived project reads null and cannot be set', async () => {
    await put(fx.owner.cookie, { projectId: fx.pArchived });
    await pool.query('UPDATE projects SET archived = TRUE WHERE id = $1', [fx.pArchived]);
    const body = await (await session(fx.owner.cookie)).json() as any;
    assert.equal(body.data.lastLocation, null);
    const res = await put(fx.owner.cookie, { projectId: fx.pArchived });
    assert.equal(res.status, 404);
    await pool.query('UPDATE projects SET archived = FALSE WHERE id = $1', [fx.pArchived]);
  });

  await t.test('an archived board reads null', async () => {
    await put(fx.owner.cookie, { projectId: fx.p1, boardId: fx.b2 });
    await pool.query('UPDATE boards SET archived = TRUE WHERE id = $1', [fx.b2]);
    const body = await (await session(fx.owner.cookie)).json() as any;
    assert.equal(body.data.lastLocation, null);
    await pool.query('UPDATE boards SET archived = FALSE WHERE id = $1', [fx.b2]);
  });

  await t.test('a user who never set a location reads null', async () => {
    const body = await (await session(fx.outsider.cookie)).json() as any;
    assert.equal(body.data.lastLocation, null);
  });
});

test('migration 0012 is additive, idempotent and embedded byte-for-byte', async () => {
  const pool = getPool();
  await runMigrations(pool);
  const sql = readFileSync(migrationPath, 'utf8');
  const executable = sql.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');
  // "ON DELETE SET NULL" is a foreign-key action, not a delete; match destructive statements only.
  assert.doesNotMatch(executable, /\b(DROP|TRUNCATE)\b|\bDELETE\s+FROM\b|\bALTER\s+COLUMN\b/i);
  // Running it a second time must not fail or change anything.
  await pool.query(sql);
  const embedded = EMBEDDED_MIGRATIONS.find((m) => m.version === '0012');
  assert.ok(embedded, 'version 0012 is embedded');
  assert.equal(embedded.sql, sql);
});
