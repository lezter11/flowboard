import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createSession } from '../src/adapters/session.ts';

test('Personal Access Tokens & Scoped Bearer Authentication Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  let aliceCookie = '';
  let aliceUserId = '';
  let projectId = '';
  let otherProjectId = '';
  let boardId = '';
  let otherBoardId = '';
  let columnId = '';

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query('TRUNCATE workspaces, users, sessions, personal_access_tokens CASCADE;');

      // 1. Create Alice
      const userRes = await client.query<{ id: string }>(
        `INSERT INTO users (id, email, display_name, created_at, updated_at)
         VALUES ('usr_alice', 'alice@flowboard.example', 'Alice Owner', NOW(), NOW())
         RETURNING id`,
      );
      aliceUserId = userRes.rows[0]!.id;

      // 2. Create Workspace
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ('ws_alice', 'Alice Workspace', 'UTC', $1, 1, NOW(), NOW())`,
        [aliceUserId],
      );

      // 3. Create Project 1
      const projRes = await client.query<{ id: string }>(
        `INSERT INTO projects (id, workspace_id, name, version, created_at, updated_at)
         VALUES ('proj_1', 'ws_alice', 'Core Platform', 1, NOW(), NOW())
         RETURNING id`,
      );
      projectId = projRes.rows[0]!.id;

      // Membership in Project 1
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ('pm_alice_1', $1, 'ws_alice', $2, 'manager', 'active', 1, NOW(), NOW())`,
        [projectId, aliceUserId],
      );

      // 4. Create Project 2
      const otherProjRes = await client.query<{ id: string }>(
        `INSERT INTO projects (id, workspace_id, name, version, created_at, updated_at)
         VALUES ('proj_2', 'ws_alice', 'Secret Finance', 1, NOW(), NOW())
         RETURNING id`,
      );
      otherProjectId = otherProjRes.rows[0]!.id;

      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ('pm_alice_2', $1, 'ws_alice', $2, 'manager', 'active', 1, NOW(), NOW())`,
        [otherProjectId, aliceUserId],
      );

      // 5. Create Board in Project 1
      const boardRes = await client.query<{ id: string }>(
        `INSERT INTO boards (id, workspace_id, project_id, name, structure_version, snapshot_version, created_at, updated_at)
         VALUES ('board_1', 'ws_alice', $1, 'Sprint Board', 1, 1, NOW(), NOW())
         RETURNING id`,
        [projectId],
      );
      boardId = boardRes.rows[0]!.id;

      // Column in Board 1
      const colRes = await client.query<{ id: string }>(
        `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
         VALUES ('col_todo', 'ws_alice', $1, $2, 'To Do', '#3b82f6', 'todo', 0, 1, NOW(), NOW())
         RETURNING id`,
        [projectId, boardId],
      );
      columnId = colRes.rows[0]!.id;

      // Board in Project 2
      const otherBoardRes = await client.query<{ id: string }>(
        `INSERT INTO boards (id, workspace_id, project_id, name, structure_version, snapshot_version, created_at, updated_at)
         VALUES ('board_2', 'ws_alice', $1, 'Finance Board', 1, 1, NOW(), NOW())
         RETURNING id`,
        [otherProjectId],
      );
      otherBoardId = otherBoardRes.rows[0]!.id;

      // Alice session for cookie testing
      const session = await createSession(aliceUserId, 24 * 7, client);
      aliceCookie = `flowboard_session=${session.id}`;
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  let fullScopeToken = '';
  let readOnlyToken = '';
  let projectRestrictedToken = '';
  let tokenId = '';

  await t.test('1. POST /api/v1/tokens: mint token with session cookie', async () => {
    const res = await app.request('/api/v1/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
      },
      body: JSON.stringify({
        name: 'Full Agent Token',
        scopes: ['cards:create', 'cards:read', 'boards:read', 'projects:read'],
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.ok(body.data.token.startsWith('flw_pat_'));
    assert.equal(body.data.tokenDetails.name, 'Full Agent Token');
    assert.deepEqual(body.data.tokenDetails.scopes, ['cards:create', 'cards:read', 'boards:read', 'projects:read']);

    fullScopeToken = body.data.token;
    tokenId = body.data.tokenDetails.id;
  });

  await t.test('2. POST /api/v1/tokens: mint read-only token', async () => {
    const res = await app.request('/api/v1/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
      },
      body: JSON.stringify({
        name: 'Read Only Token',
        scopes: ['boards:read', 'projects:read'],
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    readOnlyToken = body.data.token;
  });

  await t.test('3. POST /api/v1/tokens: mint project-restricted token', async () => {
    const res = await app.request('/api/v1/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: aliceCookie,
      },
      body: JSON.stringify({
        name: 'Project 1 Token',
        scopes: ['cards:create', 'boards:read', 'projects:read'],
        projectId: projectId,
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    projectRestrictedToken = body.data.token;
  });

  await t.test('4. GET /api/v1/tokens: list user tokens', async () => {
    const res = await app.request('/api/v1/tokens', {
      method: 'GET',
      headers: { Cookie: aliceCookie },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.length, 3);
  });

  await t.test('5. GET /api/v1/projects: accessible with Bearer token', async () => {
    const res = await app.request('/api/v1/projects', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${fullScopeToken}`,
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.data.length >= 2);
  });

  await t.test('6. GET /api/v1/projects: project-restricted token sees only its assigned project', async () => {
    const res = await app.request('/api/v1/projects', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${projectRestrictedToken}`,
      },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].id, projectId);
  });

  await t.test('7. POST /api/v1/boards/:boardId/cards: successfully creates card with cards:create token', async () => {
    const res = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fullScopeToken}`,
        'Idempotency-Key': 'key_card_creation_test_01',
      },
      body: JSON.stringify({
        title: 'Claude automated task',
        columnId: columnId,
        description: 'Created via Claude MCP server',
        expectedBoardVersion: 1,
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.data.title, 'Claude automated task');
  });

  await t.test('8. POST /api/v1/boards/:boardId/cards: fails 403 when token lacks cards:create scope', async () => {
    const res = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${readOnlyToken}`,
        'Idempotency-Key': 'key_card_creation_test_02',
      },
      body: JSON.stringify({
        title: 'Should fail',
        columnId: columnId,
        expectedBoardVersion: 2,
      }),
    });

    assert.equal(res.status, 403);
  });

  await t.test('9. POST /api/v1/boards/:boardId/cards: fails 403 when token is restricted to a different project', async () => {
    const res = await app.request(`/api/v1/boards/${otherBoardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${projectRestrictedToken}`,
        'Idempotency-Key': 'key_card_creation_test_03',
      },
      body: JSON.stringify({
        title: 'Cross-project write attempt',
        columnId: columnId,
        expectedBoardVersion: 1,
      }),
    });

    assert.equal(res.status, 403);
  });

  await t.test('10. DELETE /api/v1/tokens/:tokenId: revokes token', async () => {
    const res = await app.request(`/api/v1/tokens/${tokenId}`, {
      method: 'DELETE',
      headers: { Cookie: aliceCookie },
    });

    assert.equal(res.status, 200);
  });

  await t.test('11. POST /api/v1/boards/:boardId/cards: fails 401 with revoked token', async () => {
    const res = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fullScopeToken}`,
        'Idempotency-Key': 'key_card_creation_test_04',
      },
      body: JSON.stringify({
        title: 'Revoked write attempt',
        columnId: columnId,
        expectedBoardVersion: 2,
      }),
    });

    assert.equal(res.status, 401);
  });

  await t.test('12. POST /api/v1/tokens: a token cannot mint another token', async () => {
    const res = await app.request('/api/v1/tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${readOnlyToken}`,
      },
      body: JSON.stringify({
        name: 'Nested Token',
        scopes: ['cards:create'],
      }),
    });

    assert.equal(res.status, 403);
  });
});
