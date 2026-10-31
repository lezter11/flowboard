import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import { lockProjectQuota, lockUserQuota } from '../src/adapters/quotas.ts';

test('B-18: owned project and shared board permissions', async (t) => {
  const pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 4);
  setGlobalPool(pool);
  const app = createApp(async () => {}, { pool });
  const suffix = crypto.randomBytes(8).toString('hex');
  const users = ['owner', 'manager', 'member', 'viewer'].map((role) => ({ role, id: `b18_${role}_${suffix}` }));
  const cookies = new Map<string, string>();
  let managerBoardId = '';
  try {
    await runMigrations(pool);
    for (const user of users) {
      await pool.query('INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())', [user.id, `${user.id}@example.test`, user.role]);
      const session = await createSession(user.id, 24, pool);
      cookies.set(user.role, `flowboard_session=${session.id}`);
    }
    const create = async (role: string, path: string, body: object, key: string) => app.request(path, {
      method: 'POST', headers: { cookie: cookies.get(role)!, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body),
    });
    const ownerResponse = await create('owner', '/api/v1/projects', { name: 'Owned project' }, `b18-owner-${suffix}`);
    assert.equal(ownerResponse.status, 201, await ownerResponse.clone().text());
    const project = (await ownerResponse.json() as any).data;
    for (const user of users.slice(1)) {
      await pool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,'active',1,NOW(),NOW())`, [`pm_${user.id}`, project.id, project.workspaceId, user.id, user.role]);
    }
    const existingBoard = await create('owner', `/api/v1/projects/${project.id}/boards`, { name: 'Existing owner board' }, `b18-existing-${suffix}`);
    assert.equal(existingBoard.status, 201, await existingBoard.clone().text());
    await t.test('member and viewer cannot create shared boards; manager can', async () => {
      for (const role of ['member', 'viewer']) {
        const response = await create(role, `/api/v1/projects/${project.id}/boards`, { name: `${role} board` }, `b18-${role}-${suffix}`);
        assert.equal(response.status, 403, await response.clone().text());
      }
      const response = await create('manager', `/api/v1/projects/${project.id}/boards`, { name: 'Manager board' }, `b18-manager-${suffix}`);
      assert.equal(response.status, 201, await response.clone().text());
      const board = (await response.json() as any).data;
      managerBoardId = board.id;
      const grants = await pool.query('SELECT board_id FROM board_grants WHERE project_id=$1 AND user_id=$2', [project.id, users[1]!.id]);
      assert.deepEqual(grants.rows.map((row) => row.board_id), [board.id]);
      const events = await pool.query<{ safe_changes: { source?: string } }>(
        `SELECT safe_changes FROM activity_log WHERE project_id=$1 AND board_id=$2 AND action='board_access_granted' AND actor_id=$3`,
        [project.id, board.id, users[1]!.id],
      );
      assert.equal(events.rows.length, 1);
      assert.equal(events.rows[0]?.safe_changes.source, 'creator');
      const revision = await pool.query<{ access_revision: string }>('SELECT access_revision FROM boards WHERE id=$1', [board.id]);
      const grantOther = await app.request(`/api/v1/boards/${board.id}/grants/${users[2]!.id}`, {
        method: 'PUT', headers: { cookie: cookies.get('manager')!, 'content-type': 'application/json' },
        body: JSON.stringify({ expectedAccessRevision: revision.rows[0]!.access_revision }),
      });
      assert.equal(grantOther.status, 404, await grantOther.clone().text());
      const otherGrant = await pool.query('SELECT 1 FROM board_grants WHERE board_id=$1 AND user_id=$2', [board.id, users[2]!.id]);
      assert.equal(otherGrant.rowCount, 0);
    });
    await t.test('each shared role can create a project of their own without a workspace', async () => {
      for (const user of users.slice(1)) {
        const response = await create(user.role, '/api/v1/projects', { name: `${user.role} own project` }, `b18-own-${user.role}-${suffix}`);
        assert.equal(response.status, 201, await response.clone().text());
        const own = (await response.json() as any).data;
        const owner = await pool.query('SELECT owner_id FROM workspaces WHERE id=$1', [own.workspaceId]);
        assert.equal(owner.rows[0]?.owner_id, user.id);
      }
    });
    await t.test('a supplied workspaceId is rejected', async () => {
      const response = await create('member', '/api/v1/projects', { name: 'Wrong workspace', workspaceId: project.workspaceId }, `b18-foreign-${suffix}`);
      assert.equal(response.status, 422, await response.clone().text());
    });
    await t.test('project limit rejects the fourth create but allows replay at the cap', async () => {
      for (let index = 2; index <= 3; index++) {
        const response = await create('owner', '/api/v1/projects', { name: `Project ${index}` }, `b18-project-${index}-${suffix}`);
        assert.equal(response.status, 201, await response.clone().text());
      }
      const rejected = await create('owner', '/api/v1/projects', { name: 'Project 4' }, `b18-project-4-${suffix}`);
      assert.equal(rejected.status, 409, await rejected.clone().text());
      const error = (await rejected.json() as any).error;
      assert.equal(error.code, 'QUOTA_EXCEEDED');
      assert.equal(error.details.scope, 'owned_projects');
      assert.equal(error.details.current, 3);
      const oldRoute = await create('owner', `/api/v1/workspaces/${project.workspaceId}/projects`, { name: 'Old route project' }, `b18-old-route-${suffix}`);
      assert.equal(oldRoute.status, 409, await oldRoute.clone().text());
      assert.equal((await oldRoute.json() as any).error.code, 'QUOTA_EXCEEDED');
      const replay = await create('owner', '/api/v1/projects', { name: 'Owned project' }, `b18-owner-${suffix}`);
      assert.equal(replay.status, 201, await replay.clone().text());
      assert.equal((await replay.json() as any).data.id, project.id);
      const windows = () => pool.query<{ n: number }>(`SELECT COALESCE(sum(request_count),0)::int AS n FROM rate_limit_windows WHERE client_key=$1 AND bucket IN ('project-create','project-create-hour')`, [users[0]!.id]);
      const before = (await windows()).rows[0]!.n;
      for (let index = 0; index < 10; index++) {
        const again = await create('owner', '/api/v1/projects', { name: 'Owned project' }, `b18-owner-${suffix}`);
        assert.equal(again.status, 201);
      }
      assert.equal((await windows()).rows[0]!.n, before, 'replays spend no rate-limit tokens');
    });
    await t.test('board limit applies across creators and hides the count from a manager', async () => {
      for (let index = 3; index <= 5; index++) {
        const response = await create('owner', `/api/v1/projects/${project.id}/boards`, { name: `Board ${index}` }, `b18-board-${index}-${suffix}`);
        assert.equal(response.status, 201, await response.clone().text());
      }
      const rejected = await create('manager', `/api/v1/projects/${project.id}/boards`, { name: 'Board 6' }, `b18-board-6-${suffix}`);
      assert.equal(rejected.status, 409, await rejected.clone().text());
      const error = (await rejected.json() as any).error;
      assert.equal(error.code, 'QUOTA_EXCEEDED');
      assert.equal(error.details.scope, 'boards_per_project');
      assert.equal(error.details.current, undefined);
      const ownerRejected = await create('owner', `/api/v1/projects/${project.id}/boards`, { name: 'Owner board 6' }, `b18-owner-board-6-${suffix}`);
      assert.equal(ownerRejected.status, 409, await ownerRejected.clone().text());
      assert.equal((await ownerRejected.json() as any).error.details.current, 5);
      const replay = await create('manager', `/api/v1/projects/${project.id}/boards`, { name: 'Manager board' }, `b18-manager-${suffix}`);
      assert.equal(replay.status, 201, await replay.clone().text());
      assert.equal((await replay.json() as any).replayed, true);
    });
    await t.test('archive frees a board slot and an archived board cannot reopen at the cap', async () => {
      const active = await create('owner', `/api/v1/boards/${managerBoardId}/reopen`, {}, `b18-active-reopen-${suffix}`);
      assert.equal(active.status, 200, await active.clone().text());
      const archived = await create('owner', `/api/v1/boards/${managerBoardId}/archive`, {}, `b18-archive-${suffix}`);
      assert.equal(archived.status, 200, await archived.clone().text());
      const replacement = await create('owner', `/api/v1/projects/${project.id}/boards`, { name: 'Replacement' }, `b18-replacement-${suffix}`);
      assert.equal(replacement.status, 201, await replacement.clone().text());
      const replacementId = (await replacement.json() as any).data.id;
      const rejected = await create('owner', `/api/v1/boards/${managerBoardId}/reopen`, {}, `b18-reopen-${suffix}`);
      assert.equal(rejected.status, 409, await rejected.clone().text());
      assert.equal((await rejected.json() as any).error.code, 'QUOTA_EXCEEDED');
      const freeSlot = await create('owner', `/api/v1/boards/${replacementId}/archive`, {}, `b18-archive-replacement-${suffix}`);
      assert.equal(freeSlot.status, 200, await freeSlot.clone().text());
      const reopened = await create('owner', `/api/v1/boards/${managerBoardId}/reopen`, {}, `b18-reopen-again-${suffix}`);
      assert.equal(reopened.status, 200, await reopened.clone().text());
    });
    await t.test('two project creates waiting at the same quota lock cannot exceed the cap', async () => {
      const userId = `b18_race_${suffix}`;
      await pool.query('INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())', [userId, `${userId}@example.test`, 'Race user']);
      const session = await createSession(userId, 24, pool);
      const headers = { cookie: `flowboard_session=${session.id}`, 'content-type': 'application/json' };
      const request = async (key: string, path = '/api/v1/projects') => app.request(path, { method: 'POST', headers: { ...headers, 'idempotency-key': key }, body: JSON.stringify({ name: key }) });
      for (let index = 0; index < 2; index++) {
        const response = await request(`b18-seed-${index}-${suffix}`);
        assert.equal(response.status, 201, await response.clone().text());
      }
      const primary = await pool.query<{ id: string }>('SELECT id FROM workspaces WHERE owner_id=$1', [userId]);
      const otherWorkspace = `ws_b18_race_${suffix}`;
      await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'Other','UTC',$2,NOW(),NOW())`, [otherWorkspace, userId]);
      const blocker = await pool.connect();
      let waiting: Promise<Response>[] = [];
      try {
        await blocker.query('BEGIN');
        await lockUserQuota(blocker, userId);
        waiting = [
          request(`b18-race-a-${suffix}`, `/api/v1/workspaces/${primary.rows[0]!.id}/projects`),
          request(`b18-race-b-${suffix}`, `/api/v1/workspaces/${otherWorkspace}/projects`),
        ];
        const deadline = Date.now() + 5000;
        let blocked = 0;
        while (Date.now() < deadline && blocked < 2) {
          const result = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'`);
          blocked = result.rows[0]?.n ?? 0;
          if (blocked < 2) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(blocked, 2, 'both requests reached the held advisory lock');
        await blocker.query('COMMIT');
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
      const responses = await Promise.all(waiting);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      const count = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE w.owner_id=$1 AND NOT p.archived', [userId]);
      assert.equal(count.rows[0]?.n, 3);
    });
    await t.test('two board creates waiting at the project quota lock cannot exceed the cap', async () => {
      const archived = await create('owner', `/api/v1/boards/${managerBoardId}/archive`, {}, `b18-race-archive-${suffix}`);
      assert.equal(archived.status, 200, await archived.clone().text());
      const blocker = await pool.connect();
      let waiting: Promise<Response>[] = [];
      try {
        await blocker.query('BEGIN');
        await lockProjectQuota(blocker, project.id);
        waiting = ['a', 'b'].map((key) => create('owner', `/api/v1/projects/${project.id}/boards`, { name: `Race ${key}` }, `b18-board-race-${key}-${suffix}`));
        const deadline = Date.now() + 5000;
        let blocked = 0;
        while (Date.now() < deadline && blocked < 2) {
          const result = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'`);
          blocked = result.rows[0]?.n ?? 0;
          if (blocked < 2) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(blocked, 2, 'both requests reached the held project quota lock');
        await blocker.query('COMMIT');
      } finally {
        await blocker.query('ROLLBACK').catch(() => {});
        blocker.release();
      }
      const responses = await Promise.all(waiting);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      const count = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM boards WHERE project_id=$1 AND NOT archived', [project.id]);
      assert.equal(count.rows[0]?.n, 5);
    });
    await t.test('project archive frees a slot and reopening at the cap is rejected', async () => {
      const archived = await create('owner', `/api/v1/projects/${project.id}/archive`, {}, `b18-project-archive-${suffix}`);
      assert.equal(archived.status, 200, await archived.clone().text());
      const boardInArchivedProject = await create('owner', `/api/v1/boards/${managerBoardId}/reopen`, {}, `b18-project-archived-board-reopen-${suffix}`);
      assert.equal(boardInArchivedProject.status, 409, await boardInArchivedProject.clone().text());
      assert.equal((await boardInArchivedProject.json() as any).error.code, 'READ_ONLY_CONTEXT');
      const replacement = await create('owner', '/api/v1/projects', { name: 'Project replacement' }, `b18-project-replacement-${suffix}`);
      assert.equal(replacement.status, 201, await replacement.clone().text());
      const replacementId = (await replacement.json() as any).data.id;
      const rejected = await create('owner', `/api/v1/projects/${project.id}/reopen`, {}, `b18-project-reopen-${suffix}`);
      assert.equal(rejected.status, 409, await rejected.clone().text());
      assert.equal((await rejected.json() as any).error.code, 'QUOTA_EXCEEDED');
      const freeSlot = await create('owner', `/api/v1/projects/${replacementId}/archive`, {}, `b18-project-archive-replacement-${suffix}`);
      assert.equal(freeSlot.status, 200, await freeSlot.clone().text());
      const reopened = await create('owner', `/api/v1/projects/${project.id}/reopen`, {}, `b18-project-reopen-again-${suffix}`);
      assert.equal(reopened.status, 200, await reopened.clone().text());
    });
    await t.test('existing over-limit projects are preserved and further creation is refused', async () => {
      const userId = `b18_legacy_${suffix}`;
      const workspaceId = `ws_b18_legacy_${suffix}`;
      await pool.query('INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())', [userId, `${userId}@example.test`, 'Legacy owner']);
      await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'Personal workspace','UTC',$2,NOW(),NOW())`, [workspaceId, userId]);
      for (let index = 0; index < 4; index++) {
        await pool.query('INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())', [`prj_b18_legacy_${index}_${suffix}`, workspaceId, `Legacy ${index}`]);
      }
      const session = await createSession(userId, 24, pool);
      const response = await app.request('/api/v1/projects', { method: 'POST', headers: { cookie: `flowboard_session=${session.id}`, 'content-type': 'application/json', 'idempotency-key': `b18-legacy-${suffix}` }, body: JSON.stringify({ name: 'Extra' }) });
      assert.equal(response.status, 409, await response.clone().text());
      assert.equal((await response.json() as any).error.code, 'QUOTA_EXCEEDED');
      const count = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM projects WHERE workspace_id=$1', [workspaceId]);
      assert.equal(count.rows[0]?.n, 4);
    });
  } finally {
    await pool.end();
  }
});
