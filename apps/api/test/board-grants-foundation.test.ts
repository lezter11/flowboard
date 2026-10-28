import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { runMigrations } from '../src/adapters/migrations.ts';
import { changeBoardGrant, lockBoardAccess } from '../src/adapters/board-grants-foundation.ts';

// Destructive schema operations are confined to a uniquely named synthetic schema.
const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];
test('unmounted board-grant foundation on isolated PostgreSQL', { skip: !testUrl && 'Set FLOWBOARD_ACCESS_TEST_DATABASE_URL to a disposable local database.' }, async (t) => {
  const url = new URL(testUrl!);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname) || url.pathname !== '/flowboard_access_test') {
    throw new Error('Expected a disposable local database named flowboard_access_test.');
  }
  const schema = `access_test_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testUrl, max: 2 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: testUrl, max: 4, options: `-c search_path=${schema}` });
  try {
    await runMigrations(pool);
    assert.equal((await runMigrations(pool)).applied.length, 0);
    await pool.query(`INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES
      ('owner','owner@test.invalid','Owner',now(),now()),('manager','manager@test.invalid','Manager',now(),now()),
      ('member','member@test.invalid','Member',now(),now()),('viewer','viewer@test.invalid','Viewer',now(),now()),
      ('outside','outside@test.invalid','Outside',now(),now())`);
    await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','Workspace','UTC','owner',now(),now())`);
    await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('foreign','Foreign','UTC','outside',now(),now())`);
    await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','Project',now(),now()),('p2','w','Other',now(),now())`);
    await pool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES
      ('m1','p','w','manager','manager','active',now(),now()),('m2','p','w','member','member','active',now(),now()),
      ('m3','p','w','viewer','viewer','active',now(),now()),('m4','p2','w','outside','member','active',now(),now()),
      ('m5','p','w','outside','member','active',now(),now())`);
    await pool.query(`INSERT INTO boards (id,project_id,workspace_id,name,created_at,updated_at) VALUES
      ('b','p','w','Board',now(),now()),('b2','p2','w','Other',now(),now())`);
    async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    }
    // Convenience for cases that are not testing concurrent stale drafts. The
    // client-facing protocol must use the revision from an earlier access read.
    async function changeBoardGrantAtCurrentRevision(client: pg.PoolClient, boardId: string, actorId: string, targetId: string, allow: boolean): Promise<boolean> {
      const version = await client.query<{ access_revision: string }>('SELECT access_revision FROM boards WHERE id=$1', [boardId]);
      return changeBoardGrant(client, boardId, actorId, targetId, allow, BigInt(version.rows[0]?.access_revision ?? '0'));
    }
    async function waitUntilBlocked(pid: number, byPid: number): Promise<void> {
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await pool.query<{ blocked: boolean }>(
          'SELECT $2::int = ANY(pg_blocking_pids($1::int)) AS blocked', [pid, byPid],
        );
        if (result.rows[0]?.blocked) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('Expected transaction did not block on the other transaction.');
    }
    async function waitForSharedBoardQueue(firstPid: number, secondPid: number, blockerPid: number): Promise<void> {
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await pool.query<{ blocked: boolean }>(
          `SELECT ($3::int = ANY(pg_blocking_pids($1::int)) AND pg_blocking_pids($2::int) && ARRAY[$3::int,$1::int])
               OR ($3::int = ANY(pg_blocking_pids($2::int)) AND pg_blocking_pids($1::int) && ARRAY[$3::int,$2::int]) AS blocked`,
          [firstPid, secondPid, blockerPid],
        );
        if (result.rows[0]?.blocked) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('Expected transaction did not block in the board-lock queue.');
    }
    const missing = (error: unknown) => (error as { status?: number }).status === 404;
    await t.test('owner access is implicit and everyone else needs a board grant', async () => {
      assert.equal((await tx(c => lockBoardAccess(c, 'b', 'owner'))).role, 'owner');
      for (const actor of ['manager','member','viewer','outside']) await assert.rejects(tx(c => lockBoardAccess(c, 'b', actor)), missing);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM board_grants')).rows[0].n, 0);
    });
    await t.test('only owner grants to active project members and project role remains unchanged', async () => {
      await assert.rejects(tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'manager', 'member', true)), missing);
      await assert.rejects(tx(c => changeBoardGrantAtCurrentRevision(c, 'b2', 'owner', 'viewer', true)), missing);
      await assert.rejects(tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'owner', true)), missing);
      assert.equal(await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'viewer', true)), true);
      assert.equal((await tx(c => lockBoardAccess(c, 'b', 'viewer'))).role, 'viewer');
      assert.equal(await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'viewer', true)), false);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM activity_log WHERE action='board_access_granted'")).rows[0].n, 1);
    });
    await t.test('removal and later reactivation cannot resurrect old grants', async () => {
      await pool.query("UPDATE project_memberships SET status='removed' WHERE id='m3'");
      // Defensive cleanup: even a stale grant inserted while removed cannot revive.
      await pool.query("INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES ('b','p','w','viewer','owner')");
      await pool.query("UPDATE project_memberships SET status='active' WHERE id='m3'");
      await assert.rejects(tx(c => lockBoardAccess(c, 'b', 'viewer')), missing);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM board_grants WHERE user_id='viewer'")).rows[0].n, 0);
    });
    await t.test('ownership of another workspace does not grant board access', async () => {
      await assert.rejects(tx(c => lockBoardAccess(c, 'b', 'outside')), missing);
      assert.equal(await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'outside', true)), true);
      assert.equal((await tx(c => lockBoardAccess(c, 'b', 'outside'))).role, 'member');
      await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'outside', false));
    });
    await t.test('access revision advances for changes and removal, not no-ops', async () => {
      const revision = async () => BigInt((await pool.query("SELECT access_revision FROM boards WHERE id='b'")).rows[0].access_revision);
      const before = await revision();
      assert.equal(await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'viewer', true)), true);
      assert.equal(await revision(), before + 1n);
      assert.equal(await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'viewer', true)), false);
      assert.equal(await revision(), before + 1n);
      assert.equal(await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'viewer', false)), true);
      assert.equal(await revision(), before + 2n);
      assert.equal(await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'viewer', false)), false);
      assert.equal(await revision(), before + 2n);
      await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'viewer', true));
      await pool.query("UPDATE project_memberships SET status='removed' WHERE id='m3'");
      assert.equal(await revision(), before + 4n);
      await pool.query("UPDATE project_memberships SET status='active' WHERE id='m3'");
      assert.equal(await revision(), before + 4n);
    });
    await t.test('grant row locks serialize revocation against a held access check', async () => {
      await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'member', true));
      const reader = await pool.connect(), revoker = await pool.connect();
      try {
        await reader.query('BEGIN'); await lockBoardAccess(reader, 'b', 'member');
        await revoker.query('BEGIN'); await revoker.query("SET LOCAL lock_timeout = '100ms'");
        await assert.rejects(changeBoardGrantAtCurrentRevision(revoker, 'b', 'owner', 'member', false), e => (e as {code?: string}).code === '55P03');
        await revoker.query('ROLLBACK'); await reader.query('ROLLBACK');
      } finally { reader.release(); revoker.release(); }
      assert.equal(await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'member', false)), true);
      await assert.rejects(tx(c => lockBoardAccess(c, 'b', 'member')), missing);
    });
    await t.test('authorized write lock wins before a concurrent revocation', async () => {
      await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'member', true));
      const writer = await pool.connect(), revoker = await pool.connect();
      try {
        await writer.query('BEGIN'); await revoker.query('BEGIN');
        const writerPid = (await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        const revokerPid = (await revoker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        await lockBoardAccess(writer, 'b', 'member');
        const pending = changeBoardGrantAtCurrentRevision(revoker, 'b', 'owner', 'member', false).then(value => ({value}), error => ({error}));
        await waitUntilBlocked(revokerPid, writerPid);
        await writer.query('COMMIT');
        const result = await pending;
        assert.ok('value' in result && result.value === true);
        await revoker.query('COMMIT');
        await assert.rejects(tx(c => lockBoardAccess(c, 'b', 'member')), missing);
      } finally { await writer.query('ROLLBACK').catch(() => {}); await revoker.query('ROLLBACK').catch(() => {}); writer.release(); revoker.release(); }
    });
    await t.test('revocation wins before a concurrent access check', async () => {
      await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'member', true));
      const revoker = await pool.connect(), reader = await pool.connect();
      try {
        await revoker.query('BEGIN'); await reader.query('BEGIN');
        const revokerPid = (await revoker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        const readerPid = (await reader.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        assert.equal(await changeBoardGrantAtCurrentRevision(revoker, 'b', 'owner', 'member', false), true);
        const pending = lockBoardAccess(reader, 'b', 'member').then(value => ({value}), error => ({error}));
        await waitUntilBlocked(readerPid, revokerPid);
        await revoker.query('COMMIT');
        const result = await pending;
        assert.ok('error' in result && missing(result.error));
        await reader.query('ROLLBACK');
      } finally { await revoker.query('ROLLBACK').catch(() => {}); await reader.query('ROLLBACK').catch(() => {}); revoker.release(); reader.release(); }
    });
    await t.test('project removal waits for an in-flight owner grant, then removes it', async () => {
      const granter = await pool.connect(), remover = await pool.connect();
      try {
        await granter.query('BEGIN'); await remover.query('BEGIN');
        const gp = (await granter.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        const rp = (await remover.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        assert.equal(await changeBoardGrantAtCurrentRevision(granter, 'b', 'owner', 'member', true), true);
        const pending = remover.query("UPDATE project_memberships SET status='removed' WHERE id='m2'").then(value => ({value}), error => ({error}));
        await waitUntilBlocked(rp, gp);
        await granter.query('COMMIT');
        const result = await pending; assert.ok('value' in result);
        await remover.query('COMMIT');
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM board_grants WHERE user_id='member'")).rows[0].n, 0);
        await assert.rejects(tx(c => lockBoardAccess(c, 'b', 'member')), missing);
      } finally { await granter.query('ROLLBACK').catch(() => {}); await remover.query('ROLLBACK').catch(() => {}); granter.release(); remover.release(); }
      await pool.query("UPDATE project_memberships SET status='active' WHERE id='m2'");
    });
    await t.test('owner grant waits for removal, then rejects the removed project member', async () => {
      const granter = await pool.connect(), remover = await pool.connect();
      try {
        await granter.query('BEGIN'); await remover.query('BEGIN');
        const gp = (await granter.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        const rp = (await remover.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        await remover.query("UPDATE project_memberships SET status='removed' WHERE id='m2'");
        const pending = changeBoardGrantAtCurrentRevision(granter, 'b', 'owner', 'member', true).then(value => ({value}), error => ({error}));
        await waitUntilBlocked(gp, rp);
        await remover.query('COMMIT');
        const result = await pending; assert.ok('error' in result && missing(result.error));
        await granter.query('ROLLBACK');
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM board_grants WHERE user_id='member'")).rows[0].n, 0);
      } finally { await granter.query('ROLLBACK').catch(() => {}); await remover.query('ROLLBACK').catch(() => {}); granter.release(); remover.release(); }
      await pool.query("UPDATE project_memberships SET status='active' WHERE id='m2'");
    });
    await t.test('stale retries and no-ops cannot undo a later revocation', async () => {
      const getRevision = async () => BigInt((await pool.query("SELECT access_revision FROM boards WHERE id='b'")).rows[0].access_revision);
      const original = await getRevision();
      assert.equal(await tx(c => changeBoardGrant(c, 'b', 'owner', 'member', true, original)), true);
      const grantedRevision = await getRevision();
      assert.equal(await tx(c => changeBoardGrant(c, 'b', 'owner', 'member', false, grantedRevision)), true);
      const revokedRevision = await getRevision();
      const stale = (error: unknown) => (error as { status?: number; code?: string }).status === 409 && (error as { code?: string }).code === 'STALE_ACCESS_REVISION';
      // An old PUT cannot resurrect the grant, and an old DELETE cannot be
      // accepted as a no-op just because the desired state now matches.
      await assert.rejects(tx(c => changeBoardGrant(c, 'b', 'owner', 'member', true, original)), stale);
      await assert.rejects(tx(c => changeBoardGrant(c, 'b', 'owner', 'member', false, grantedRevision)), stale);
      assert.equal(await getRevision(), revokedRevision);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM board_grants WHERE board_id='b' AND user_id='member'")).rows[0].n, 0);
      assert.equal(await tx(c => changeBoardGrant(c, 'b', 'owner', 'member', false, revokedRevision)), false);
    });
    await t.test('concurrent absent-grant mutations serialize via the board revision', async () => {
      const revision = BigInt((await pool.query("SELECT access_revision FROM boards WHERE id='b'")).rows[0].access_revision);
      const first = await pool.connect(), second = await pool.connect();
      try {
        await first.query('BEGIN'); await second.query('BEGIN');
        const firstPid = (await first.query<{ pid:number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        const secondPid = (await second.query<{ pid:number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        assert.equal(await changeBoardGrant(first, 'b', 'owner', 'member', true, revision), true);
        // Viewer has no grant either, so there is no existing grant row for
        // this second operation to wait on: it must serialize on the board.
        const pending = changeBoardGrant(second, 'b', 'owner', 'viewer', true, revision).then(value => ({value}), error => ({error}));
        await waitUntilBlocked(secondPid, firstPid);
        await first.query('COMMIT');
        const result = await pending;
        assert.ok('error' in result && (result.error as {code?:string}).code === 'STALE_ACCESS_REVISION');
        await second.query('ROLLBACK');
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM board_grants WHERE board_id='b' AND user_id='viewer'")).rows[0].n, 0);
      } finally { await first.query('ROLLBACK').catch(() => {}); await second.query('ROLLBACK').catch(() => {}); first.release(); second.release(); }
      await tx(c => changeBoardGrantAtCurrentRevision(c, 'b', 'owner', 'member', false));
    });
    await t.test('concurrent multi-board removals complete and invalidate every affected board', async () => {
      await pool.query("INSERT INTO boards (id,project_id,workspace_id,name,created_at,updated_at) VALUES ('c','p','w','Second',now(),now())");
      for (const user of ['member', 'viewer']) for (const board of ['b', 'c']) await tx(c => changeBoardGrantAtCurrentRevision(c, board, 'owner', user, true));
      const before = await pool.query<{ id:string; access_revision:string }>("SELECT id, access_revision FROM boards WHERE id IN ('b','c') ORDER BY id");
      const blocker = await pool.connect(), first = await pool.connect(), second = await pool.connect();
      try {
        await blocker.query('BEGIN'); await first.query('BEGIN'); await second.query('BEGIN');
        await first.query("SET LOCAL statement_timeout = '5s'"); await second.query("SET LOCAL statement_timeout = '5s'");
        await blocker.query("SELECT id FROM boards WHERE id='b' FOR UPDATE");
        const bp = (await blocker.query<{ pid:number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        const fp = (await first.query<{ pid:number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        const sp = (await second.query<{ pid:number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
        const a = first.query("UPDATE project_memberships SET status='removed' WHERE id='m2'").then(value => ({value}), error => ({error}));
        const b = second.query("UPDATE project_memberships SET status='removed' WHERE id='m3'").then(value => ({value}), error => ({error}));
        // Either updater may reach the board first. The other can be queued
        // behind that updater's tuple lock or the original blocker.
        await waitForSharedBoardQueue(fp, sp, bp);
        await blocker.query('COMMIT');
        const winner = await Promise.race([a.then(result => ({which:'first',result})), b.then(result => ({which:'second',result}))]);
        assert.ok('value' in winner.result);
        if (winner.which === 'first') {
          await first.query('COMMIT'); const other = await b; assert.ok('value' in other); await second.query('COMMIT');
        } else {
          await second.query('COMMIT'); const other = await a; assert.ok('value' in other); await first.query('COMMIT');
        }
        const after = await pool.query<{ id:string; access_revision:string }>("SELECT id, access_revision FROM boards WHERE id IN ('b','c') ORDER BY id");
        for (let i=0; i<before.rows.length; i++) assert.equal(BigInt(after.rows[i]!.access_revision), BigInt(before.rows[i]!.access_revision)+2n);
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM board_grants WHERE user_id IN ('member','viewer')")).rows[0].n, 0);
      } finally { await blocker.query('ROLLBACK').catch(() => {}); await first.query('ROLLBACK').catch(() => {}); await second.query('ROLLBACK').catch(() => {}); blocker.release(); first.release(); second.release(); }
      await pool.query("UPDATE project_memberships SET status='active' WHERE id IN ('m2','m3')");
    });
    await t.test('draft DDL and its prerequisite schema roll back atomically', async () => {
      const rollbackSchema = `${schema}_rollback`;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`CREATE SCHEMA "${rollbackSchema}"`);
        await client.query(`SET LOCAL search_path TO "${rollbackSchema}"`);
        const migrations = new URL('../../../database/migrations/', import.meta.url);
        const names = (await readdir(migrations)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
        for (const name of names) await client.query(await readFile(new URL(name, migrations), 'utf8'));
        assert.ok((await client.query("SELECT to_regclass('board_grants') AS name")).rows[0]?.name);
        await client.query('ROLLBACK');
        assert.equal((await pool.query('SELECT to_regnamespace($1) AS name', [rollbackSchema])).rows[0]?.name, null);
      } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    });
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
