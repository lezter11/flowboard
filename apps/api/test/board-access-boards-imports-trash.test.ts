import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { createApp } from '../src/http/app.ts';
import { setGlobalPool } from '../src/adapters/postgres.ts';

const testUrl = process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL'];

test('mounted board, import and trash routes require current board access', {
  skip: !testUrl && 'Set FLOWBOARD_ACCESS_TEST_DATABASE_URL to the disposable local board-access database.',
}, async () => {
  const url = new URL(testUrl!);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.pathname !== '/flowboard_access_test') {
    throw new Error('Use only the disposable local board-access database.');
  }

  const schema = `board_paths_${crypto.randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Pool({ connectionString: testUrl, max: 2 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: testUrl, max: 8, options: `-c search_path=${schema}` });

  try {
    await runMigrations(pool);
    const owner = await createDevUserAndSession('owner-boards@test.invalid', 'Owner', pool);
    const manager = await createDevUserAndSession('manager-boards@test.invalid', 'Manager', pool);
    await pool.query(
      `INSERT INTO workspaces (id, name, timezone, owner_id, created_at, updated_at)
       VALUES ('w', 'Workspace', 'UTC', $1, NOW(), NOW())`, [owner.user.id],
    );
    await pool.query(
      `INSERT INTO projects (id, workspace_id, name, created_at, updated_at)
       VALUES ('p', 'w', 'Project', NOW(), NOW())`,
    );
    await pool.query(
      `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
       VALUES ('pm', 'p', 'w', $1, 'manager', 'active', NOW(), NOW())`, [manager.user.id],
    );
    await pool.query(
      `INSERT INTO boards (id, workspace_id, project_id, name, structure_version, snapshot_version, archived, created_at, updated_at)
       VALUES ('b', 'w', 'p', 'Private Board', 1, 1, FALSE, NOW(), NOW())`,
    );
    await pool.query(
      `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
       VALUES ('col', 'w', 'p', 'b', 'To Do', 'blue', 'todo', 0, 1, NOW(), NOW())`,
    );
    await pool.query(
      `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, state, created_at, updated_at)
       VALUES ('active', 'w', 'p', 'b', 'col', 'Private active', 'none', 100, 'active', NOW(), NOW()),
              ('trashed', 'w', 'p', 'b', 'col', 'Private trashed', 'none', 200, 'trashed', NOW(), NOW())`,
    );
    await pool.query(
      `UPDATE cards SET deleted_at = NOW(), deleted_by = $1, restore_until = NOW() + INTERVAL '24 hours' WHERE id = 'trashed'`,
      [owner.user.id],
    );
    await pool.query(
      `INSERT INTO card_imports (id, workspace_id, project_id, board_id, default_column_id, uploader_id, version, state, preview_digest, expires_at, created_at, updated_at)
       VALUES ('imp', 'w', 'p', 'b', 'col', $1, 1, 'ready', 'digest', NOW() + INTERVAL '30 minutes', NOW(), NOW())`,
      [owner.user.id],
    );

    const app = createApp(async () => {}, { pool });
    const request = (method: string, path: string, session: string, body?: unknown, key = crypto.randomUUID()) =>
      app.request(`http://localhost/api/v1${path}`, {
        method,
        headers: {
          cookie: `flowboard_session=${session}`,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(method !== 'GET' ? { 'Idempotency-Key': key } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });

    const patchBody = { name: 'Renamed', expectedVersion: 1 };
    assert.equal((await request('GET', '/boards/b', manager.session.id)).status, 404);
    assert.equal((await request('PATCH', '/boards/b', manager.session.id, patchBody)).status, 404);
    assert.equal((await request('POST', '/boards/b/archive', manager.session.id)).status, 404);
    assert.equal((await request('POST', '/boards/b/reopen', manager.session.id)).status, 404);
    assert.equal((await request('GET', '/boards/b/card-import-template', manager.session.id)).status, 404);
    assert.equal((await request('GET', '/card-imports/imp', manager.session.id)).status, 404);
    assert.equal((await request('POST', '/card-imports/imp/commit', manager.session.id,
      { expectedVersion: 1, previewDigest: 'digest', defaultColumnId: 'col' })).status, 404);
    assert.equal((await request('POST', '/cards/active/delete', manager.session.id,
      { expectedVersion: 1, expectedBoardVersion: 1 })).status, 404);
    assert.equal((await request('POST', '/cards/trashed/restore', manager.session.id,
      { expectedVersion: 1, expectedBoardVersion: 1 })).status, 404);
    const hiddenTrash = await request('GET', '/projects/p/trash', manager.session.id);
    assert.equal(hiddenTrash.status, 200);
    assert.deepEqual((await hiddenTrash.json()).data, []);
    const ownerTrash = await request('GET', '/projects/p/trash', owner.session.id);
    assert.equal(ownerTrash.status, 200);
    assert.equal((await ownerTrash.json()).data.length, 1);

    await pool.query(
      `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
       VALUES ('b', 'p', 'w', $1, $2)`, [manager.user.id, owner.user.id],
    );
    assert.equal((await request('GET', '/boards/b', manager.session.id)).status, 200);
    assert.equal((await request('GET', '/card-imports/imp', manager.session.id)).status, 200);
    const grantedTrash = await request('GET', '/projects/p/trash', manager.session.id);
    assert.equal(grantedTrash.status, 200);
    assert.equal((await grantedTrash.json()).data.length, 1);
    const commitBody = { expectedVersion: 1, previewDigest: 'digest', defaultColumnId: 'col' };
    const commitKey = crypto.randomUUID();
    assert.equal((await request('POST', '/card-imports/imp/commit', manager.session.id, commitBody, commitKey)).status, 200);
    const restoreKey = crypto.randomUUID();
    assert.equal((await request('POST', '/cards/trashed/restore', manager.session.id,
      { expectedVersion: 1, expectedBoardVersion: 2 }, restoreKey)).status, 200);
    const deleteKey = crypto.randomUUID();
    const deleted = await request('POST', '/cards/active/delete', manager.session.id,
      { expectedVersion: 1, expectedBoardVersion: 3 }, deleteKey);
    assert.equal(deleted.status, 200);
    const archivedKey = crypto.randomUUID();
    assert.equal((await request('POST', '/boards/b/archive', manager.session.id, undefined, archivedKey)).status, 200);
    const reopenKey = crypto.randomUUID();
    assert.equal((await request('POST', '/boards/b/reopen', manager.session.id, undefined, reopenKey)).status, 200);
    const key = crypto.randomUUID();
    const currentVersion = Number((await pool.query(`SELECT snapshot_version FROM boards WHERE id = 'b'`)).rows[0].snapshot_version);
    assert.equal((await request('PATCH', '/boards/b', manager.session.id,
      { ...patchBody, expectedVersion: currentVersion }, key)).status, 200);
    await pool.query(`DELETE FROM board_grants WHERE board_id = 'b' AND user_id = $1`, [manager.user.id]);
    assert.equal((await request('PATCH', '/boards/b', manager.session.id,
      { ...patchBody, expectedVersion: currentVersion }, key)).status, 404);
    assert.equal((await request('POST', '/card-imports/imp/commit', manager.session.id, commitBody, commitKey)).status, 404);
    assert.equal((await request('POST', '/cards/active/delete', manager.session.id,
      { expectedVersion: 1, expectedBoardVersion: 3 }, deleteKey)).status, 404);
    assert.equal((await request('POST', '/cards/trashed/restore', manager.session.id,
      { expectedVersion: 1, expectedBoardVersion: 2 }, restoreKey)).status, 404);
    assert.equal((await request('POST', '/boards/b/archive', manager.session.id, undefined, archivedKey)).status, 404);
    assert.equal((await request('POST', '/boards/b/reopen', manager.session.id, undefined, reopenKey)).status, 404);
    assert.equal((await request('GET', '/card-imports/imp', manager.session.id)).status, 404);
  } finally {
    setGlobalPool(null);
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
