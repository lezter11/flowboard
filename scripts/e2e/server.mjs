// Local synthetic integration harness. Never imported by either product runtime.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { serve } from '@hono/node-server';
import { createApp } from '../../apps/api/src/http/app.ts';
import { runMigrations } from '../../apps/api/src/adapters/migrations.ts';
import { createDevUserAndSession } from '../../apps/api/src/adapters/session.ts';
import { MemoryStorageDriver } from '../../apps/api/src/adapters/storage.ts';
import { SharpImageVerifier } from '../../apps/api/src/services/image-verifier-node.ts';

export async function startSyntheticApi() {
  assert.equal(process.env.NODE_ENV, 'test', 'Synthetic browser harness requires explicit test mode.');
  // A random, process-only test signing key; never read real account configuration.
  const previousCursorSecret=process.env.CURSOR_SECRET;
  if(!previousCursorSecret)process.env.CURSOR_SECRET=crypto.randomBytes(32).toString('base64url');
  const connectionString = process.env.FLOWBOARD_UI_TEST_DATABASE_URL;
  assert.ok(connectionString, 'Explicit disposable UI database is required.');
  const url = new URL(connectionString);
  assert.ok(['postgres:','postgresql:'].includes(url.protocol));
  assert.equal(url.hostname, '127.0.0.1');
  assert.ok(url.port && !['55432','55479'].includes(url.port),'Use an explicit disposable test port.');
  assert.equal(url.username,'flowboard_harness');
  assert.equal(url.pathname, '/flowboard_ui_test');
  assert.equal(url.search,'');
  const schema=`browser_${crypto.randomUUID().replaceAll('-','')}`;
  const admin=new pg.Pool({connectionString,max:1});
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString, max: 8,options:`-c search_path=${schema}` });
  try { await runMigrations(pool); }
  catch(error) { await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();throw error; }
  const app = createApp(async () => { await pool.query('SELECT 1'); }, {
    pool, storage: new MemoryStorageDriver(), imageVerifier: new SharpImageVerifier(),
    rateLimiter: () => ({ limit: async () => ({ success: true }) }),
    windowCounter: () => ({ consume: async () => ({ count: 1, retryAfterSeconds: 60 }) }),
  });
  const fixtures = [];
  async function fixture() {
    const suffix = crypto.randomUUID().replaceAll('-', '');
    const people = {};
    for (const role of ['owner', 'manager', 'member', 'viewer', 'outsider']) {
      people[role] = await createDevUserAndSession(`${role}.${suffix}@example.invalid`, `Synthetic ${role}`, pool);
    }
    async function call(role, method, path, body, key = crypto.randomUUID()) {
      const headers = { cookie: `flowboard_session=${people[role].session.id}`,
        'content-type': 'application/json', origin: 'http://127.0.0.1:44931', 'idempotency-key': key };
      const response = await app.request(`http://127.0.0.1:44931${path}`, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      assert.ok(response.ok, `Synthetic fixture API ${method} ${path} status ${response.status}`);
      return result;
    }
    const project = (await call('owner', 'POST', '/api/v1/projects', { name: `Browser project ${suffix.slice(0, 6)}` })).data;
    const board = (await call('owner', 'POST', `/api/v1/projects/${project.id}/boards`, { name: 'Browser regression board' })).data;
    const columns = (await pool.query('SELECT id,name,category FROM columns WHERE board_id=$1 ORDER BY position', [board.id])).rows;
    assert.ok(columns.length >= 3);
    for (const role of ['manager', 'member', 'viewer']) {
      const userId = people[role].user.id;
      await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,'active',1,NOW(),NOW())`, [`pm_${crypto.randomUUID()}`, project.id, project.workspaceId, userId, role]);
      await pool.query(`INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by)
        VALUES($1,$2,$3,$4,$5)`, [board.id, project.id, project.workspaceId, userId, people.owner.user.id]);
    }
    const hiddenBoard = (await call('owner', 'POST', `/api/v1/projects/${project.id}/boards`, { name: 'Hidden board sentinel' })).data;
    const cards = [];
    for (let i = 0; i < 24; i++) {
      const version = Number((await pool.query('SELECT structure_version FROM boards WHERE id=$1', [board.id])).rows[0].structure_version);
      cards.push((await call('owner', 'POST', `/api/v1/boards/${board.id}/cards`, {
        title: `Regression card ${String(i + 1).padStart(2, '0')}`, columnId: columns[0].id,
        description: i === 0 ? 'Synthetic full card description' : '', priority: i % 2 ? 'low' : 'high',
        expectedBoardVersion: version,
      })).data);
    }
    const value = { people, project, board, hiddenBoard, columns, cards, call, pool };
    fixtures.push(value);
    return value;
  }
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 44931 });
  return {
    fixture, pool,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
      if(previousCursorSecret===undefined)delete process.env.CURSOR_SECRET;
    },
  };
}
