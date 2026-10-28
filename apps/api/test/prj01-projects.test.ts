import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createSession } from '../src/adapters/session.ts';
import { projectSchema, projectListResponseSchema } from '@flowboard/contracts';

test('PRJ-01: Create multiple projects & sibling isolation Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  const aliceUserId = 'usr_alice_prj01';
  const bobUserId = 'usr_bob_prj01';
  const charlieUserId = 'usr_charlie_prj01';

  let aliceCookie = '';
  let bobCookie = '';
  let charlieCookie = '';

  const workspaceId = 'ws_alice_prj01_test';

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query('TRUNCATE workspaces, users, sessions, idempotency_receipts, projects, project_memberships CASCADE;');

      // Seed Alice (Workspace Owner)
      await client.query(
        `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [aliceUserId, 'alice.prj01@flowboard.example', 'Alice Owner', null],
      );
      const aliceSession = await createSession(aliceUserId, 24, client);
      aliceCookie = `flowboard_session=${aliceSession.id}`;

      // Seed Bob (Granted member of Project A only)
      await client.query(
        `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [bobUserId, 'bob.prj01@flowboard.example', 'Bob Member', null],
      );
      const bobSession = await createSession(bobUserId, 24, client);
      bobCookie = `flowboard_session=${bobSession.id}`;

      // Seed Charlie (Outsider with no project grants)
      await client.query(
        `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [charlieUserId, 'charlie.prj01@flowboard.example', 'Charlie Outsider', null],
      );
      const charlieSession = await createSession(charlieUserId, 24, client);
      charlieCookie = `flowboard_session=${charlieSession.id}`;

      // Create Alice's workspace
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, NOW(), NOW())`,
        [workspaceId, 'Alice Workspace', 'UTC', aliceUserId],
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  const projAKey = 'idem_key_project_a_001';
  let projectAId = '';
  let projectBId = '';

  await t.test('1. Project creation by workspace owner succeeds', async () => {
    const res = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': projAKey,
      },
      body: JSON.stringify({
        name: 'Project Alpha',
        description: 'First engineering project',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.replayed, false);

    const project = projectSchema.parse(body.data);
    assert.ok(project.id.startsWith('prj_'));
    assert.equal(project.workspaceId, workspaceId);
    assert.equal(project.name, 'Project Alpha');
    assert.equal(project.description, 'First engineering project');
    assert.equal(project.isArchived, false);
    assert.equal(project.version, 1);
    assert.ok(project.createdAt.endsWith('Z'));
    assert.ok(project.updatedAt.endsWith('Z'));

    projectAId = project.id;

    // Verify database row
    const client = await pool.connect();
    try {
      const q = await client.query('SELECT * FROM projects WHERE id = $1', [projectAId]);
      assert.equal(q.rows.length, 1);
      assert.equal(q.rows[0].workspace_id, workspaceId);
      assert.equal(q.rows[0].name, 'Project Alpha');
    } finally {
      client.release();
    }
  });

  await t.test('2. Non-owner attempting to create project in workspace returns 404 NOT_FOUND', async () => {
    // Bob is not workspace owner
    const res = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: bobCookie,
        'Idempotency-Key': 'idem_key_bob_forbidden_01',
      },
      body: JSON.stringify({
        name: 'Unauthorized Project',
        description: 'Should not be allowed',
      }),
    });

    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.match(body.error.message, /Workspace not found or unauthorized/);
  });

  await t.test('3. Workspace owner creates second project (Project Beta)', async () => {
    const res = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': 'idem_key_project_b_001',
      },
      body: JSON.stringify({
        name: 'Project Beta',
        description: 'Second confidential project',
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    projectBId = body.data.id;
    assert.ok(projectBId.startsWith('prj_'));
  });

  await t.test('4. Sibling project privacy: user in Project A requesting Project B gets 404 NOT_FOUND', async () => {
    // Add Bob to Project A only
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'member', 'active', 1, NOW(), NOW())`,
        ['pm_bob_alpha', projectAId, workspaceId, bobUserId],
      );
    } finally {
      client.release();
    }

    // Bob can read Project A
    const getProjectARes = await app.request(`/api/v1/projects/${projectAId}`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(getProjectARes.status, 200);
    const projABody = await getProjectARes.json();
    assert.equal(projABody.data.id, projectAId);
    assert.equal(projABody.data.name, 'Project Alpha');

    // Bob cannot read sibling Project B -> gets 404 NOT_FOUND without leaking metadata
    const getProjectBRes = await app.request(`/api/v1/projects/${projectBId}`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(getProjectBRes.status, 404);
    const projBBody = await getProjectBRes.json();
    assert.equal(projBBody.error.code, 'NOT_FOUND');
  });

  await t.test('5. GET /api/v1/workspaces/:workspaceId/projects scopes accessible projects per role', async () => {
    // Bob only sees Project Alpha (granted project)
    const bobListRes = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      headers: { Cookie: bobCookie },
    });
    assert.equal(bobListRes.status, 200);
    const bobListBody = await bobListRes.json();
    const bobParsed = projectListResponseSchema.parse(bobListBody);
    assert.equal(bobParsed.data.length, 1);
    assert.equal(bobParsed.data[0]?.id, projectAId);
    assert.equal(bobParsed.data[0]?.name, 'Project Alpha');

    // Alice (owner) sees all projects in workspace (Project Alpha and Project Beta)
    const aliceListRes = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      headers: { Cookie: aliceCookie },
    });
    assert.equal(aliceListRes.status, 200);
    const aliceListBody = await aliceListRes.json();
    const aliceParsed = projectListResponseSchema.parse(aliceListBody);
    assert.equal(aliceParsed.data.length, 2);
    const names = aliceParsed.data.map((p) => p.name).sort();
    assert.deepEqual(names, ['Project Alpha', 'Project Beta']);

    // Charlie (outsider with no grants) gets 404 NOT_FOUND
    const charlieListRes = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      headers: { Cookie: charlieCookie },
    });
    assert.equal(charlieListRes.status, 404);
    const charlieBody = await charlieListRes.json();
    assert.equal(charlieBody.error.code, 'NOT_FOUND');
  });

  await t.test('6. Idempotency replay on project creation returns replayed: true', async () => {
    const replayRes = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': projAKey,
      },
      body: JSON.stringify({
        name: 'Project Alpha',
        description: 'First engineering project',
      }),
    });

    assert.equal(replayRes.status, 201);
    const body = await replayRes.json();
    assert.equal(body.replayed, true);
    assert.equal(body.data.id, projectAId);
    assert.equal('name' in body.data, false);

    // Verify row count for Project Alpha is still 1
    const client = await pool.connect();
    try {
      const q = await client.query('SELECT COUNT(*)::integer AS count FROM projects WHERE name = $1', ['Project Alpha']);
      assert.equal(q.rows[0].count, 1);
    } finally {
      client.release();
    }
  });

  await t.test('7. Idempotency conflict on project creation returns 409 IDEMPOTENCY_CONFLICT', async () => {
    const conflictRes = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
        'Idempotency-Key': projAKey,
      },
      body: JSON.stringify({
        name: 'Project Alpha Changed',
        description: 'Different payload',
      }),
    });

    assert.equal(conflictRes.status, 409);
    const body = await conflictRes.json();
    assert.equal(body.error.code, 'IDEMPOTENCY_CONFLICT');
  });
});
