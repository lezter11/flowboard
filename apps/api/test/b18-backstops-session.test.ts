import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import { DEFAULT_LIMITS, limitsFromEnv } from '../src/services/limits.ts';
import { startNode } from '../src/runtime/node.ts';
import worker from '../src/runtime/worker.ts';

test('backstops count archived items and session exposes effective limits', async (t) => {
  const pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 4);
  setGlobalPool(pool);
  const app = createApp(async () => {}, { pool, limits: { ...DEFAULT_LIMITS, ownedProjectsTotal: 3, boardsPerProjectTotal: 3 } });
  const suffix = crypto.randomBytes(8).toString('hex');
  const userId = `b18_total_${suffix}`;
  try {
    await runMigrations(pool);
    await pool.query('INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())', [userId, `${userId}@example.test`, 'Owner']);
    const session = await createSession(userId, 24, pool);
    const cookie = `flowboard_session=${session.id}`;
    let serial = 0;
    const post = async (path: string, body: object = {}, key = `total-${suffix}-${serial++}`) => app.request(path, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
    const projectKey = `total-first-project-${suffix}`;
    const projectResponse = await post('/api/v1/projects', { name: 'First' }, projectKey);
    assert.equal(projectResponse.status, 201, await projectResponse.clone().text());
    const project = (await projectResponse.json() as any).data;
    const memberId = `b18_total_member_${suffix}`;
    await pool.query('INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())', [memberId, `${memberId}@example.test`, 'Member']);
    await pool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at) VALUES ($1,$2,$3,$4,'member','active',1,NOW(),NOW())`, [`pm_${memberId}`, project.id, project.workspaceId, memberId]);
    const memberSession = await createSession(memberId, 24, pool);
    const sharedSession = await app.request('/api/v1/session', { headers: { cookie: `flowboard_session=${memberSession.id}` } });
    assert.equal(sharedSession.status, 200, await sharedSession.clone().text());
    const shared = (await sharedSession.json() as any).data;
    assert.equal(shared.accessibleProjects.find((item: any) => item.id === project.id).isOwned, false);
    assert.deepEqual(shared.limits.ownedProjects, { limit: 3, used: 0 });
    await t.test('Node runtime applies environment overrides to session limits', async () => {
      const previous = process.env['FB_LIMIT_OWNED_PROJECTS'];
      process.env['FB_LIMIT_OWNED_PROJECTS'] = '2';
      const runtime = startNode(0, localDatabaseUrl(process.env['DATABASE_URL']));
      try {
        if (!runtime.server.address()) await new Promise<void>((resolve) => runtime.server.once('listening', resolve));
        const address = runtime.server.address();
        assert.ok(address && typeof address !== 'string');
        const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/session`, { headers: { cookie } });
        assert.equal(response.status, 200);
        assert.equal((await response.json() as any).data.limits.ownedProjects.limit, 2);
      } finally {
        await runtime.close();
        if (previous === undefined) delete process.env['FB_LIMIT_OWNED_PROJECTS'];
        else process.env['FB_LIMIT_OWNED_PROJECTS'] = previous;
      }
    });
    await t.test('Worker handler applies environment overrides to session limits', async () => {
      const response = await worker.fetch(new Request('http://localhost/api/v1/session', { headers: { cookie } }), {
        HYPERDRIVE: { connectionString: localDatabaseUrl(process.env['DATABASE_URL']) },
        FB_LIMIT_OWNED_PROJECTS: '2',
      } as never);
      assert.equal(response.status, 200);
      assert.equal((await response.json() as any).data.limits.ownedProjects.limit, 2);
    });
    await t.test('board archive cycles reach the total backstop', async () => {
      for (let index = 0; index < 3; index++) {
        const response = await post(`/api/v1/projects/${project.id}/boards`, { name: `Board ${index}` }, `total-board-${index}-${suffix}`);
        assert.equal(response.status, 201, await response.clone().text());
        const board = (await response.json() as any).data;
        const archived = await post(`/api/v1/boards/${board.id}/archive`);
        assert.equal(archived.status, 200, await archived.clone().text());
      }
      const rejected = await post(`/api/v1/projects/${project.id}/boards`, { name: 'Extra' });
      assert.equal(rejected.status, 409, await rejected.clone().text());
      const error = (await rejected.json() as any).error;
      assert.equal(error.details.scope, 'boards_per_project_total');
      assert.equal(error.details.remedy, 'none');
      assert.equal(error.details.current, 3);
      const replay = await post(`/api/v1/projects/${project.id}/boards`, { name: 'Board 0' }, `total-board-0-${suffix}`);
      assert.equal(replay.status, 201, await replay.clone().text());
      assert.equal((await replay.json() as any).replayed, true);
      await pool.query(`UPDATE project_memberships SET role='manager' WHERE project_id=$1 AND user_id=$2`, [project.id, memberId]);
      const managerRejected = await app.request(`/api/v1/projects/${project.id}/boards`, {
        method: 'POST', headers: { cookie: `flowboard_session=${memberSession.id}`, 'content-type': 'application/json', 'idempotency-key': `total-manager-${suffix}` }, body: JSON.stringify({ name: 'Manager extra' }),
      });
      assert.equal(managerRejected.status, 409, await managerRejected.clone().text());
      const managerError = (await managerRejected.json() as any).error;
      assert.equal(managerError.details.scope, 'boards_per_project_total');
      assert.equal(managerError.details.current, undefined);
    });
    await t.test('project archive cycles reach the total backstop', async () => {
      for (const id of [project.id]) {
        const archived = await post(`/api/v1/projects/${id}/archive`);
        assert.equal(archived.status, 200, await archived.clone().text());
      }
      for (let index = 0; index < 2; index++) {
        const response = await post('/api/v1/projects', { name: `Project ${index}` });
        assert.equal(response.status, 201, await response.clone().text());
        const created = (await response.json() as any).data;
        const archived = await post(`/api/v1/projects/${created.id}/archive`);
        assert.equal(archived.status, 200, await archived.clone().text());
      }
      const rejected = await post('/api/v1/projects', { name: 'Extra' });
      assert.equal(rejected.status, 409, await rejected.clone().text());
      const error = (await rejected.json() as any).error;
      assert.equal(error.details.scope, 'owned_projects_total');
      assert.equal(error.details.remedy, 'none');
      assert.equal(error.details.current, 3);
      const replay = await post('/api/v1/projects', { name: 'First' }, projectKey);
      assert.equal(replay.status, 201, await replay.clone().text());
      assert.equal((await replay.json() as any).data.id, project.id);
      const sessionResponse = await app.request('/api/v1/session', { headers: { cookie } });
      assert.equal(sessionResponse.status, 200, await sessionResponse.clone().text());
      const data = (await sessionResponse.json() as any).data;
      assert.deepEqual(data.limits.ownedProjects, { limit: 3, used: 0 });
      assert.equal(data.limits.boardsPerProject.limit, 5);
      assert.equal(data.accessibleProjects.find((item: any) => item.id === project.id).isOwned, true);
    });
    await t.test('invalid overrides fall back and valid overrides apply', () => {
      for (const invalid of ['', '0', '3O', '-1', '5000']) {
        assert.equal(limitsFromEnv({ FB_LIMIT_OWNED_PROJECTS_TOTAL: invalid }).ownedProjectsTotal, 20);
      }
      assert.equal(limitsFromEnv({ FB_LIMIT_BOARDS_PER_PROJECT_TOTAL: '42' }).boardsPerProjectTotal, 42);
    });
  } finally { await pool.end(); }
});

test('default 20-project and 25-board backstops include archived rows', async () => {
  const pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 4);
  setGlobalPool(pool);
  const app = createApp(async () => {}, { pool });
  const suffix = crypto.randomBytes(8).toString('hex');
  const userId = `b18_defaults_${suffix}`;
  const workspaceId = `ws_b18_defaults_${suffix}`;
  const projectId = `prj_b18_defaults_${suffix}`;
  try {
    await runMigrations(pool);
    await pool.query('INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW())', [userId, `${userId}@example.test`, 'Default owner']);
    await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'Personal workspace','UTC',$2,NOW(),NOW())`, [workspaceId, userId]);
    await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'Active',NOW(),NOW())`, [projectId, workspaceId]);
    for (let index = 0; index < 18; index++) {
      await pool.query(`INSERT INTO projects (id,workspace_id,name,archived,created_at,updated_at) VALUES ($1,$2,'Archived',true,NOW(),NOW())`, [`prj_b18_old_${index}_${suffix}`, workspaceId]);
    }
    for (let index = 0; index < 24; index++) {
      await pool.query(`INSERT INTO boards (id,workspace_id,project_id,name,archived,created_at,updated_at) VALUES ($1,$2,$3,'Archived',true,NOW(),NOW())`, [`brd_b18_old_${index}_${suffix}`, workspaceId, projectId]);
    }
    const session = await createSession(userId, 24, pool);
    let serial = 0;
    const post = async (path: string, body: object = {}) => app.request(path, { method: 'POST', headers: { cookie: `flowboard_session=${session.id}`, 'content-type': 'application/json', 'idempotency-key': `default-${suffix}-${serial++}` }, body: JSON.stringify(body) });
    const boardResponse = await post(`/api/v1/projects/${projectId}/boards`, { name: 'Twenty fifth' });
    assert.equal(boardResponse.status, 201, await boardResponse.clone().text());
    const board = (await boardResponse.json() as any).data;
    assert.equal((await post(`/api/v1/boards/${board.id}/archive`)).status, 200);
    const extraBoard = await post(`/api/v1/projects/${projectId}/boards`, { name: 'Twenty sixth' });
    assert.equal(extraBoard.status, 409, await extraBoard.clone().text());
    assert.equal((await extraBoard.json() as any).error.details.scope, 'boards_per_project_total');
    const projectResponse = await post('/api/v1/projects', { name: 'Twentieth' });
    assert.equal(projectResponse.status, 201, await projectResponse.clone().text());
    const project = (await projectResponse.json() as any).data;
    assert.equal((await post(`/api/v1/projects/${project.id}/archive`)).status, 200);
    const extraProject = await post('/api/v1/projects', { name: 'Twenty first' });
    assert.equal(extraProject.status, 409, await extraProject.clone().text());
    assert.equal((await extraProject.json() as any).error.details.scope, 'owned_projects_total');
  } finally { await pool.end(); }
});
