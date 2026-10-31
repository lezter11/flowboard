import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { before, after } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { insertWorkspaceForUser } from './support/workspace-fixture.ts';

// ACC-04 (B-20). POST /api/v1/workspaces is retired: it answers 410 to an authenticated caller and 401 to
// an anonymous one. GET /api/v1/workspaces lists only the workspaces the caller owns. Workspaces are made
// by sign-in and by the first project create, so this file inserts them with the fixture helper.

test('ACC-04 (B-20): workspace routes after the retirement', async (t) => {
  const pool = getPool();
  const app = createApp();

  before(async () => {
    await runMigrations(pool);
  });
  after(async () => {
    await closePool();
  });

  const owner = await createDevUserAndSession(`acc04.owner.${crypto.randomUUID()}@flowboard.example`, 'Owner', pool);
  const cookie = `flowboard_session=${owner.session.id}`;

  await t.test('1. An anonymous POST gets 401, not 410: authentication still comes first', async () => {
    const res = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ name: 'Anonymous', timezone: 'UTC' }),
    });
    assert.equal(res.status, 401);
  });

  await t.test('2. An authenticated POST gets 410 WORKSPACE_CREATE_RETIRED and creates nothing', async () => {
    const before = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM workspaces WHERE owner_id = $1', [owner.user.id]);
    const res = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ name: 'Retired', timezone: 'UTC' }),
    });
    assert.equal(res.status, 410);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'WORKSPACE_CREATE_RETIRED');
    const after = await pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM workspaces WHERE owner_id = $1', [owner.user.id]);
    assert.equal(after.rows[0]!.n, before.rows[0]!.n, 'no workspace was written');
  });

  await t.test('3. GET lists owned workspaces only, and never one the caller is merely a member of', async () => {
    const ownWs = await insertWorkspaceForUser(owner.user.id, { name: 'Own' });
    const other = await createDevUserAndSession(`acc04.other.${crypto.randomUUID()}@flowboard.example`, 'Other', pool);
    const foreignWs = await insertWorkspaceForUser(other.user.id, { name: 'Foreign' });
    // The owner joins a project in the foreign workspace as a member. That must not list the foreign workspace.
    await pool.query(
      `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
       VALUES ($1, $2, 'Shared', NULL, FALSE, 1, NOW(), NOW())`,
      [`prj_${crypto.randomUUID()}`, foreignWs.id],
    );
    const projectRow = await pool.query<{ id: string }>(`SELECT id FROM projects WHERE workspace_id = $1`, [foreignWs.id]);
    await pool.query(
      `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'member', 'active', NOW(), NOW())`,
      [`pm_${crypto.randomUUID()}`, projectRow.rows[0]!.id, foreignWs.id, owner.user.id],
    );

    const res = await app.request('/api/v1/workspaces', { headers: { Cookie: cookie } });
    assert.equal(res.status, 200);
    const ids = ((await res.json()) as { data: Array<{ id: string }> }).data.map((w) => w.id);
    assert.ok(ids.includes(ownWs.id), 'the owner sees their own workspace');
    assert.equal(ids.includes(foreignWs.id), false, 'a membership does not list the foreign workspace');
  });
});
