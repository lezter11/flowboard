import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool } from '../src/adapters/postgres.ts';
import { createSession } from '../src/adapters/session.ts';
import {
  boardSchema,
  boardResponseSchema,
  boardListResponseSchema,
  boardSnapshotResponseSchema,
  columnSchema,
  placementResponseSchema,
  cardListResponseSchema,
} from '@flowboard/contracts';

test('BRD-01 to BRD-07: Board & Column Lifecycle Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  const workspaceId = 'ws_brd_test';
  const projectAId = 'prj_brd_alpha';
  const projectBId = 'prj_brd_beta';

  const aliceOwnerId = 'usr_alice_brd_owner';
  const bobManagerId = 'usr_bob_brd_mgr';
  const charlieMemberId = 'usr_charlie_brd_member';
  const daveViewerId = 'usr_dave_brd_viewer';
  const eveOutsiderId = 'usr_eve_brd_outsider';

  let aliceCookie = '';
  let bobCookie = '';
  let charlieCookie = '';
  let daveCookie = '';
  let eveCookie = '';

  let createdBoardId = '';
  let defaultColIds: string[] = [];

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query(`
        TRUNCATE workspaces, users, sessions, idempotency_receipts,
                 projects, project_memberships, boards, columns, cards,
                 card_assignees, comments, card_images CASCADE;
      `);

      // Seed Users
      const users = [
        { id: aliceOwnerId, email: 'alice.brd@flowboard.example', name: 'Alice Owner' },
        { id: bobManagerId, email: 'bob.brd@flowboard.example', name: 'Bob Manager' },
        { id: charlieMemberId, email: 'charlie.brd@flowboard.example', name: 'Charlie Member' },
        { id: daveViewerId, email: 'dave.brd@flowboard.example', name: 'Dave Viewer' },
        { id: eveOutsiderId, email: 'eve.brd@flowboard.example', name: 'Eve Outsider' },
      ];

      for (const u of users) {
        await client.query(
          `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())`,
          [u.id, u.email, u.name, `https://flowboard.example/avatars/${u.id}.png`],
        );
      }

      // Sessions
      const sAlice = await createSession(aliceOwnerId, 24, client);
      aliceCookie = `flowboard_session=${sAlice.id}`;

      const sBob = await createSession(bobManagerId, 24, client);
      bobCookie = `flowboard_session=${sBob.id}`;

      const sCharlie = await createSession(charlieMemberId, 24, client);
      charlieCookie = `flowboard_session=${sCharlie.id}`;

      const sDave = await createSession(daveViewerId, 24, client);
      daveCookie = `flowboard_session=${sDave.id}`;

      const sEve = await createSession(eveOutsiderId, 24, client);
      eveCookie = `flowboard_session=${sEve.id}`;

      // Workspace (Alice is owner)
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, NOW(), NOW())`,
        [workspaceId, 'Board Lifecycle Workspace', 'UTC', aliceOwnerId],
      );

      // Projects
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, 1, NOW(), NOW()),
                ($5, $2, $6, $7, FALSE, 1, NOW(), NOW())`,
        [projectAId, workspaceId, 'Project Alpha', 'Alpha description', projectBId, 'Project Beta', 'Beta description'],
      );

      // Memberships for Project Alpha
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ('pm_bob_alpha', $1, $2, $3, 'manager', 'active', 1, NOW(), NOW()),
                ('pm_charlie_alpha', $1, $2, $4, 'member', 'active', 1, NOW(), NOW()),
                ('pm_dave_alpha', $1, $2, $5, 'viewer', 'active', 1, NOW(), NOW())`,
        [projectAId, workspaceId, bobManagerId, charlieMemberId, daveViewerId],
      );
    } finally {
      client.release();
    }
  });

  // ==========================================================================
  // BRD-01: Create board & default columns
  // ==========================================================================
  await t.test('BRD-01: Workspace owner can create board with atomic default columns', async () => {
    const res = await app.request(`/api/v1/projects/${projectAId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': aliceCookie,
        'Idempotency-Key': 'idemp_brd01_create_owner',
      },
      body: JSON.stringify({ name: 'Alpha Main Board' }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    boardResponseSchema.parse(json);

    createdBoardId = json.data.id;
    await pool.query(
      `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
       VALUES ($1, $2, $3, $4, $7), ($1, $2, $3, $5, $7), ($1, $2, $3, $6, $7)`,
      [createdBoardId, projectAId, workspaceId, bobManagerId, charlieMemberId, daveViewerId, aliceOwnerId],
    );
    assert.equal(json.data.name, 'Alpha Main Board');
    assert.equal(json.data.projectId, projectAId);
    assert.equal(json.data.workspaceId, workspaceId);
    assert.equal(json.data.structureVersion, 1);
    assert.equal(json.data.snapshotVersion, 1);
    assert.equal(json.data.isArchived, false);

    // Verify 5 default columns in DB, in order, with Blocked at position 3
    const colsRes = await pool.query<{ name: string; category: string; color: string; position: number; id: string }>(
      `SELECT id, name, category, color, position FROM columns WHERE board_id = $1 ORDER BY position ASC`,
      [createdBoardId],
    );

    assert.equal(colsRes.rows.length, 5);
    assert.deepEqual(
      colsRes.rows.map((r) => ({ name: r.name, category: r.category, color: r.color, position: r.position })),
      [
        { name: 'Not started', category: 'todo', color: '#64748b', position: 0 },
        { name: 'In progress', category: 'active', color: '#0ea5e9', position: 1 },
        { name: 'Testing', category: 'active', color: '#f59e0b', position: 2 },
        { name: 'Blocked', category: 'active', color: '#ef4444', position: 3 },
        { name: 'Completed', category: 'done', color: '#10b981', position: 4 },
      ],
    );

    defaultColIds = colsRes.rows.map((r) => r.id);
  });

  await t.test('BRD-01a: a board that already exists keeps its four columns when new defaults ship', async () => {
    // Existing boards were created with the old four-column default. Creating a new board
    // must not add, remove or rename columns on them.
    const legacyBoardId = 'brd_legacy_four_cols';
    await pool.query(
      `INSERT INTO boards (id, workspace_id, project_id, name, created_at, updated_at)
       VALUES ($1, $2, $3, 'Legacy Board', now(), now())`,
      [legacyBoardId, workspaceId, projectAId],
    );
    const legacy = [
      ['Not started', 'todo', '#64748b', 0],
      ['In progress', 'active', '#0ea5e9', 1],
      ['Testing', 'active', '#f59e0b', 2],
      ['Completed', 'done', '#10b981', 3],
    ] as const;
    for (const [name, category, color, position] of legacy) {
      await pool.query(
        `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, now(), now())`,
        [`col_legacy_${position}`, workspaceId, projectAId, legacyBoardId, name, color, category, position],
      );
    }

    const createRes = await app.request(`/api/v1/projects/${projectAId}/boards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aliceCookie, 'Idempotency-Key': 'idemp_brd01a_new' },
      body: JSON.stringify({ name: 'Post Change Board' }),
    });
    assert.equal(createRes.status, 201);

    const legacyCols = await pool.query<{ name: string; position: number }>(
      'SELECT name, position FROM columns WHERE board_id = $1 ORDER BY position ASC',
      [legacyBoardId],
    );
    assert.deepEqual(
      legacyCols.rows,
      legacy.map(([name, , , position]) => ({ name, position })),
    );
  });

  await t.test('BRD-01: Project manager can also create boards', async () => {
    const res = await app.request(`/api/v1/projects/${projectAId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': bobCookie,
        'Idempotency-Key': 'idemp_brd01_create_mgr',
      },
      body: JSON.stringify({ name: 'Manager Sprint Board' }),
    });

    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.data.name, 'Manager Sprint Board');
    const mgrBoardId = json.data.id;
    await pool.query(
      `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
       VALUES ($1, $2, $3, $4, $6), ($1, $2, $3, $5, $6)`,
      [mgrBoardId, projectAId, workspaceId, charlieMemberId, daveViewerId, aliceOwnerId],
    );
  });

  await t.test('BRD-01: Members and viewers receive 403 FORBIDDEN when attempting to create board', async () => {
    // Member attempt
    const memRes = await app.request(`/api/v1/projects/${projectAId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': charlieCookie,
        'Idempotency-Key': 'idemp_brd01_mem_fail',
      },
      body: JSON.stringify({ name: 'Member Illegal Board' }),
    });
    assert.equal(memRes.status, 403);
    const memJson = await memRes.json();
    assert.equal(memJson.error.code, 'FORBIDDEN');

    // Viewer attempt
    const vRes = await app.request(`/api/v1/projects/${projectAId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': daveCookie,
        'Idempotency-Key': 'idemp_brd01_v_fail',
      },
      body: JSON.stringify({ name: 'Viewer Illegal Board' }),
    });
    assert.equal(vRes.status, 403);
    const vJson = await vRes.json();
    assert.equal(vJson.error.code, 'FORBIDDEN');
  });

  await t.test('BRD-01: Ungranted user receives 404 NOT_FOUND when attempting to create board', async () => {
    const res = await app.request(`/api/v1/projects/${projectAId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': eveCookie,
        'Idempotency-Key': 'idemp_brd01_eve_fail',
      },
      body: JSON.stringify({ name: 'Outsider Board' }),
    });
    assert.equal(res.status, 404);
  });

  await t.test('BRD-01: Idempotency enforcement on board creation', async () => {
    // Replay returns cached receipt with replayed: true
    const replayRes = await app.request(`/api/v1/projects/${projectAId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': aliceCookie,
        'Idempotency-Key': 'idemp_brd01_create_owner',
      },
      body: JSON.stringify({ name: 'Alpha Main Board' }),
    });

    assert.equal(replayRes.status, 201);
    const json = await replayRes.json();
    assert.equal(json.data.id, createdBoardId);
    assert.equal(json.replayed, true);

    // Conflict on key reuse with different body
    const conflictRes = await app.request(`/api/v1/projects/${projectAId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': aliceCookie,
        'Idempotency-Key': 'idemp_brd01_create_owner',
      },
      body: JSON.stringify({ name: 'Totally Different Name' }),
    });

    assert.equal(conflictRes.status, 409);
    const conflictJson = await conflictRes.json();
    assert.equal(conflictJson.error.code, 'IDEMPOTENCY_CONFLICT');
  });

  // ==========================================================================
  // BRD-02: Board listing & settings / OCC
  // ==========================================================================
  await t.test('BRD-02: Listing boards returns active boards for granted project members', async () => {
    // Member can list
    const memRes = await app.request(`/api/v1/projects/${projectAId}/boards`, {
      headers: { Cookie: charlieCookie },
    });
    assert.equal(memRes.status, 200);
    const memJson = await memRes.json();
    boardListResponseSchema.parse(memJson);
    assert.equal(memJson.data.length, 2);

    // Viewer can list
    const vRes = await app.request(`/api/v1/projects/${projectAId}/boards`, {
      headers: { Cookie: daveCookie },
    });
    assert.equal(vRes.status, 200);
    const vJson = await vRes.json();
    boardListResponseSchema.parse(vJson);
    assert.equal(vJson.data.length, 2);

    // Outsider gets 404
    const outsiderRes = await app.request(`/api/v1/projects/${projectAId}/boards`, {
      headers: { Cookie: eveCookie },
    });
    assert.equal(outsiderRes.status, 404);
  });

  await t.test('BRD-02: Updating board name with OCC check', async () => {
    // Board rename is owner only (B-3). Alice is the workspace owner, so the OCC checks run as her.
    // Stale version returns 409 STALE_VERSION
    const staleRes = await app.request(`/api/v1/boards/${createdBoardId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': aliceCookie,
        'Idempotency-Key': 'idemp_brd02_patch_stale',
      },
      body: JSON.stringify({ name: 'Renamed Alpha', expectedVersion: 999 }),
    });
    assert.equal(staleRes.status, 409);
    const staleJson = await staleRes.json();
    assert.equal(staleJson.error.code, 'STALE_VERSION');

    // Valid update by the owner
    const validRes = await app.request(`/api/v1/boards/${createdBoardId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': aliceCookie,
        'Idempotency-Key': 'idemp_brd02_patch_valid',
      },
      body: JSON.stringify({ name: 'Renamed Alpha Board', expectedVersion: 1 }),
    });
    assert.equal(validRes.status, 200);
    const validJson = await validRes.json();
    assert.equal(validJson.data.name, 'Renamed Alpha Board');
    assert.equal(validJson.data.snapshotVersion, 2);

    // A manager (Bob) may not rename the board: 403, and the name is unchanged
    const managerRes = await app.request(`/api/v1/boards/${createdBoardId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': bobCookie,
        'Idempotency-Key': 'idemp_brd02_patch_mgr',
      },
      body: JSON.stringify({ name: 'Manager Rename', expectedVersion: 2 }),
    });
    assert.equal(managerRes.status, 403);
    assert.equal((await managerRes.json()).error.code, 'FORBIDDEN');

    // Member forbidden
    const memRes = await app.request(`/api/v1/boards/${createdBoardId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': charlieCookie,
        'Idempotency-Key': 'idemp_brd02_patch_mem',
      },
      body: JSON.stringify({ name: 'Member Rename', expectedVersion: 2 }),
    });
    assert.equal(memRes.status, 403);
  });

  // ==========================================================================
  // BRD-04: Add and update columns
  // ==========================================================================
  let customColId = '';

  await t.test('BRD-04: Add column verifies OCC, uniqueness, and role', async () => {
    // Stale board version rejected
    const staleRes = await app.request(`/api/v1/boards/${createdBoardId}/columns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': bobCookie,
        'Idempotency-Key': 'idemp_brd04_stale_col',
      },
      body: JSON.stringify({
        name: 'QA Staging',
        color: '#6366f1',
        category: 'active',
        expectedBoardVersion: 99,
      }),
    });
    assert.equal(staleRes.status, 409);

    // Duplicate name rejected (case-insensitive & trimmed)
    const dupRes = await app.request(`/api/v1/boards/${createdBoardId}/columns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': bobCookie,
        'Idempotency-Key': 'idemp_brd04_dup_col',
      },
      body: JSON.stringify({
        name: '  in PROGRESS  ',
        color: '#6366f1',
        category: 'active',
        expectedBoardVersion: 1,
      }),
    });
    assert.equal(dupRes.status, 409);
    const dupJson = await dupRes.json();
    assert.equal(dupJson.error.code, 'DUPLICATE_COLUMN_NAME');

    // Successful column addition
    const addRes = await app.request(`/api/v1/boards/${createdBoardId}/columns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': bobCookie,
        'Idempotency-Key': 'idemp_brd04_add_col',
      },
      body: JSON.stringify({
        name: 'QA Review',
        color: '#8b5cf6',
        category: 'active',
        expectedBoardVersion: 1,
      }),
    });

    assert.equal(addRes.status, 201);
    const addJson = await addRes.json();
    columnSchema.parse(addJson.data);
    assert.equal(addJson.data.name, 'QA Review');
    assert.equal(addJson.data.position, 5);
    assert.equal(addJson.data.activeCardCount, 0);
    customColId = addJson.data.id;
  });

  await t.test('BRD-04: Updating column fields & enforcing name uniqueness', async () => {
    // Current board structure_version is 2 after addColumn
    // Duplicate rename rejected
    const dupRes = await app.request(`/api/v1/boards/${createdBoardId}/columns/${customColId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': bobCookie,
        'Idempotency-Key': 'idemp_brd04_rename_dup',
      },
      body: JSON.stringify({
        name: 'Testing',
        expectedBoardVersion: 2,
      }),
    });
    assert.equal(dupRes.status, 409);

    // Valid update
    const patchRes = await app.request(`/api/v1/boards/${createdBoardId}/columns/${customColId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': bobCookie,
        'Idempotency-Key': 'idemp_brd04_rename_valid',
      },
      body: JSON.stringify({
        name: 'Staging & Verification',
        color: '#a855f7',
        expectedBoardVersion: 2,
      }),
    });

    assert.equal(patchRes.status, 200);
    const patchJson = await patchRes.json();
    assert.equal(patchJson.data.name, 'Staging & Verification');
    assert.equal(patchJson.data.color, '#a855f7');
  });

  await t.test('BRD-04: Maximum 12 columns bound enforced', async () => {
    // Create dedicated board to test 12 columns bound
    const createRes = await app.request(`/api/v1/projects/${projectAId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': bobCookie,
        'Idempotency-Key': 'idemp_limit_board',
      },
      body: JSON.stringify({ name: 'Column Limit Test Board' }),
    });
    assert.equal(createRes.status, 201);
    const createJson = await createRes.json();
    const limitBoardId = createJson.data.id;
    const creatorGrant = await pool.query('SELECT 1 FROM board_grants WHERE board_id=$1 AND user_id=$2', [limitBoardId, bobManagerId]);
    assert.equal(creatorGrant.rowCount, 1);

    // limitBoardId starts with 5 default columns, structure_version = 1; add up to the 12-column bound
    let curVer = 1;
    for (let i = 6; i <= 12; i++) {
      const res = await app.request(`/api/v1/boards/${limitBoardId}/columns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': bobCookie,
          'Idempotency-Key': `idemp_limit_col_${i}`,
        },
        body: JSON.stringify({
          name: `Column ${i}`,
          color: '#3b82f6',
          category: 'active',
          expectedBoardVersion: curVer,
        }),
      });
      assert.equal(res.status, 201);
      curVer++;
    }

    // 13th column must be rejected with 400
    const overflowRes = await app.request(`/api/v1/boards/${limitBoardId}/columns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': bobCookie,
        'Idempotency-Key': 'idemp_limit_col_13',
      },
      body: JSON.stringify({
        name: 'Column 13 Overflow',
        color: '#ef4444',
        category: 'active',
        expectedBoardVersion: curVer,
      }),
    });

    assert.equal(overflowRes.status, 400);
    const overflowJson = await overflowRes.json();
    assert.equal(overflowJson.error.code, 'COLUMN_LIMIT_EXCEEDED');
  });

  // ==========================================================================
  // BRD-05: Reorder columns & placement calculation
  // ==========================================================================
  await t.test('BRD-05: Reordering columns requires complete exact set and OCC', async () => {
    // Get current columns and board version
    const bRes = await pool.query<{ structure_version: number }>(
      `SELECT structure_version FROM boards WHERE id = $1`,
      [createdBoardId],
    );
    const curVersion = bRes.rows[0]!.structure_version;

    const colsRes = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM columns WHERE board_id = $1 ORDER BY position ASC`,
      [createdBoardId],
    );
    const cols = colsRes.rows;
    // 5 default columns plus the custom 'QA Review' column added above
    assert.equal(cols.length, 6);

    // Incomplete column set rejected with 400
    const incompleteRes = await app.request(`/api/v1/boards/${createdBoardId}/columns/reorder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': bobCookie,
        'Idempotency-Key': 'idemp_brd05_incomplete',
      },
      body: JSON.stringify({
        columnIds: [cols[0]!.id, cols[1]!.id],
        expectedBoardVersion: curVersion,
      }),
    });
    assert.equal(incompleteRes.status, 400);

    // Stale version rejected with 409
    const staleRes = await app.request(`/api/v1/boards/${createdBoardId}/columns/reorder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': bobCookie,
        'Idempotency-Key': 'idemp_brd05_stale',
      },
      body: JSON.stringify({
        columnIds: cols.map((c) => c.id).reverse(),
        expectedBoardVersion: curVersion - 1,
      }),
    });
    assert.equal(staleRes.status, 409);

    // Successful reverse reorder
    const reversedIds = cols.map((c) => c.id).reverse();
    const reorderRes = await app.request(`/api/v1/boards/${createdBoardId}/columns/reorder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': bobCookie,
        'Idempotency-Key': 'idemp_brd05_valid',
      },
      body: JSON.stringify({
        columnIds: reversedIds,
        expectedBoardVersion: curVersion,
      }),
    });

    assert.equal(reorderRes.status, 200);
    const reorderJson = await reorderRes.json();
    assert.equal(reorderJson.data.structureVersion, curVersion + 1);

    // Verify positions in DB match exactly 0..4
    const newPosRes = await pool.query<{ id: string; position: number }>(
      `SELECT id, position FROM columns WHERE board_id = $1 ORDER BY position ASC`,
      [createdBoardId],
    );
    assert.deepEqual(newPosRes.rows.map((r) => r.id), reversedIds);
    assert.deepEqual(newPosRes.rows.map((r) => r.position), [0, 1, 2, 3, 4, 5]);
  });

  await t.test('BRD-05: Card placement neighbor calculation (first, last, before, after)', async () => {
    const targetColId = defaultColIds[0]!;
    // Insert 3 test cards in target column plus the moving card
    await pool.query(
      `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, version, state, created_at, updated_at)
       VALUES ('c_place_1', $1, $2, $3, $4, 'Card 1', 'none', 1000, 1, 'active', NOW(), NOW()),
              ('c_place_2', $1, $2, $3, $4, 'Card 2', 'none', 2000, 1, 'active', NOW(), NOW()),
              ('c_place_3', $1, $2, $3, $4, 'Card 3', 'none', 3000, 1, 'active', NOW(), NOW()),
              ('c_new', $1, $2, $3, $4, 'Moving Card', 'none', 4000, 1, 'active', NOW(), NOW())`,
      [workspaceId, projectAId, createdBoardId, targetColId],
    );

    // 1. Placement at 'first'
    const firstRes = await app.request(
      `/api/v1/boards/${createdBoardId}/columns/${targetColId}/placement?movingCardId=c_new&at=first`,
      { headers: { Cookie: charlieCookie } },
    );
    assert.equal(firstRes.status, 200);
    const firstJson = await firstRes.json();
    placementResponseSchema.parse(firstJson);
    assert.equal(firstJson.data.previousCardId, null);
    assert.equal(firstJson.data.nextCardId, 'c_place_1');

    // 2. Placement at 'last'
    const lastRes = await app.request(
      `/api/v1/boards/${createdBoardId}/columns/${targetColId}/placement?movingCardId=c_new&at=last`,
      { headers: { Cookie: charlieCookie } },
    );
    assert.equal(lastRes.status, 200);
    const lastJson = await lastRes.json();
    assert.equal(lastJson.data.previousCardId, 'c_place_3');
    assert.equal(lastJson.data.nextCardId, null);

    // 3. Placement 'before' c_place_2
    const beforeRes = await app.request(
      `/api/v1/boards/${createdBoardId}/columns/${targetColId}/placement?movingCardId=c_new&at=before&anchorCardId=c_place_2`,
      { headers: { Cookie: charlieCookie } },
    );
    assert.equal(beforeRes.status, 200);
    const beforeJson = await beforeRes.json();
    assert.equal(beforeJson.data.previousCardId, 'c_place_1');
    assert.equal(beforeJson.data.nextCardId, 'c_place_2');

    // 4. Placement 'after' c_place_2
    const afterRes = await app.request(
      `/api/v1/boards/${createdBoardId}/columns/${targetColId}/placement?movingCardId=c_new&at=after&anchorCardId=c_place_2`,
      { headers: { Cookie: charlieCookie } },
    );
    assert.equal(afterRes.status, 200);
    const afterJson = await afterRes.json();
    assert.equal(afterJson.data.previousCardId, 'c_place_2');
    assert.equal(afterJson.data.nextCardId, 'c_place_3');
  });

  // ==========================================================================
  // BRD-06: Remove column & reference guards
  // ==========================================================================
  await t.test('BRD-06: Column deletion guards: active cards, restorable trash, final column', async () => {
    const colWithActiveCards = defaultColIds[0]!;
    const emptyColId = customColId;

    const bRes = await pool.query<{ structure_version: number }>(
      `SELECT structure_version FROM boards WHERE id = $1`,
      [createdBoardId],
    );
    let curVer = bRes.rows[0]!.structure_version;

    // 1. Column with active cards rejected with 409
    const activeBlockRes = await app.request(
      `/api/v1/boards/${createdBoardId}/columns/${colWithActiveCards}?expectedBoardVersion=${curVer}`,
      {
        method: 'DELETE',
        headers: {
          'Cookie': bobCookie,
          'Idempotency-Key': 'idemp_del_active_block',
        },
      },
    );
    assert.equal(activeBlockRes.status, 409);
    const activeBlockJson = await activeBlockRes.json();
    assert.equal(activeBlockJson.error.code, 'COLUMN_HAS_ACTIVE_CARDS');

    // 2. Put a restorable trashed card into empty column
    await pool.query(
      `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, version, state, restore_until, created_at, updated_at)
       VALUES ('c_trashed_1', $1, $2, $3, $4, 'Trashed Card', 'none', 5000, 1, 'trashed', NOW() + INTERVAL '23 hours', NOW(), NOW())`,
      [workspaceId, projectAId, createdBoardId, emptyColId],
    );

    const trashBlockRes = await app.request(
      `/api/v1/boards/${createdBoardId}/columns/${emptyColId}?expectedBoardVersion=${curVer}`,
      {
        method: 'DELETE',
        headers: {
          'Cookie': bobCookie,
          'Idempotency-Key': 'idemp_del_trash_block',
        },
      },
    );
    assert.equal(trashBlockRes.status, 409);
    const trashBlockJson = await trashBlockRes.json();
    assert.equal(trashBlockJson.error.code, 'COLUMN_HAS_RESTORABLE_CARDS');

    // Remove the trashed card to make it truly empty
    await pool.query(`DELETE FROM cards WHERE id = 'c_trashed_1'`);

    // 3. Successful deletion of truly empty column
    const deleteRes = await app.request(
      `/api/v1/boards/${createdBoardId}/columns/${emptyColId}?expectedBoardVersion=${curVer}`,
      {
        method: 'DELETE',
        headers: {
          'Cookie': bobCookie,
          'Idempotency-Key': 'idemp_del_empty_valid',
        },
      },
    );
    assert.equal(deleteRes.status, 200);
    const deleteJson = await deleteRes.json();
    assert.equal(deleteJson.data.id, emptyColId);
    curVer = deleteJson.data.structureVersion;

    // Verify remaining 4 columns are compacted 0..3
    const remRes = await pool.query<{ id: string; position: number }>(
      `SELECT id, position FROM columns WHERE board_id = $1 ORDER BY position ASC`,
      [createdBoardId],
    );
    // 6 columns before the delete, 5 after
    assert.equal(remRes.rows.length, 5);
    assert.deepEqual(remRes.rows.map((r) => r.position), [0, 1, 2, 3, 4]);

    // 4. Test Final Column protection: create single-column board
    const singleBrdRes = await pool.query<{ id: string }>(
      `INSERT INTO boards (id, workspace_id, project_id, name, structure_version, snapshot_version, archived, created_at, updated_at)
       VALUES ('brd_single', $1, $2, 'Single Col Board', 1, 1, FALSE, NOW(), NOW())
       RETURNING id`,
      [workspaceId, projectAId],
    );
    await pool.query(
      `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
       VALUES ('col_only', $1, $2, 'brd_single', 'Sole Column', '#3b82f6', 'todo', 0, 1, NOW(), NOW())`,
      [workspaceId, projectAId],
    );
    await pool.query(
      `INSERT INTO board_grants (workspace_id, project_id, board_id, user_id, granted_by)
       VALUES ($1, $2, 'brd_single', $3, $4)`,
      [workspaceId, projectAId, bobManagerId, aliceOwnerId],
    );

    const finalColRes = await app.request(
      `/api/v1/boards/brd_single/columns/col_only?expectedBoardVersion=1`,
      {
        method: 'DELETE',
        headers: {
          'Cookie': bobCookie,
          'Idempotency-Key': 'idemp_del_final_block',
        },
      },
    );
    assert.equal(finalColRes.status, 400);
    const finalColJson = await finalColRes.json();
    assert.equal(finalColJson.error.code, 'FINAL_COLUMN_CANNOT_BE_DELETED');
  });

  // ==========================================================================
  // BRD-03: Board snapshot & counts contract
  // ==========================================================================
  await t.test('BRD-03: Consistent bounded snapshot with active vs matching counts and people disclosure', async () => {
    // Clean up cards from previous tests on createdBoardId
    await pool.query(`DELETE FROM cards WHERE board_id = $1`, [createdBoardId]);

    const col0 = defaultColIds[0]!;
    const col1 = defaultColIds[1]!;

    // Seed 4 active cards and 1 trashed card
    await pool.query(
      `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, due_date, position, version, state, created_at, updated_at)
       VALUES ('c_snap_1', $1, $2, $3, $4, 'Urgent bug fix', 'urgent', '2020-01-01', 10, 1, 'active', NOW(), NOW()),
              ('c_snap_2', $1, $2, $3, $4, 'Low priority cleanup', 'low', '2030-01-01', 20, 1, 'active', NOW(), NOW()),
              ('c_snap_3', $1, $2, $3, $5, 'Urgent feature', 'urgent', NULL, 10, 1, 'active', NOW(), NOW()),
              ('c_snap_4', $1, $2, $3, $5, 'High priority doc', 'high', NULL, 20, 1, 'active', NOW(), NOW()),
              ('c_snap_trashed', $1, $2, $3, $4, 'Trashed card', 'urgent', NULL, 30, 1, 'trashed', NOW(), NOW())`,
      [workspaceId, projectAId, createdBoardId, col0, col1],
    );

    // Assign Bob and Charlie to c_snap_1
    await pool.query(
      `INSERT INTO card_assignees (card_id, user_id, workspace_id, project_id, created_at)
       VALUES ('c_snap_1', $1, $3, $4, NOW()),
              ('c_snap_1', $2, $3, $4, NOW())`,
      [bobManagerId, charlieMemberId, workspaceId, projectAId],
    );

    // 1. Unfiltered Snapshot
    const unfilteredRes = await app.request(`/api/v1/boards/${createdBoardId}`, {
      headers: { Cookie: charlieCookie },
    });
    assert.equal(unfilteredRes.status, 200);
    const snapJson = await unfilteredRes.json();
    boardSnapshotResponseSchema.parse(snapJson);

    const snap = snapJson.data;
    assert.equal(snap.board.id, createdBoardId);
    assert.equal(snap.totals.activeCardCount, 4); // 4 active cards, trashed excluded
    assert.equal(snap.totals.matchingCardCount, 4);
    assert.equal(snap.columns.length, 5);

    // People disclosure contains Bob and Charlie
    assert.equal(snap.people.length, 2);
    const personIds = snap.people.map((p: any) => p.id).sort();
    assert.deepEqual(personIds, [bobManagerId, charlieMemberId].sort());

    // 2. Filtered Snapshot by priority=urgent
    const filteredRes = await app.request(`/api/v1/boards/${createdBoardId}?priority=urgent`, {
      headers: { Cookie: charlieCookie },
    });
    assert.equal(filteredRes.status, 200);
    const fJson = await filteredRes.json();
    const fSnap = fJson.data;

    // activeCardCount remains 4; matchingCardCount is 2 ('Urgent bug fix' + 'Urgent feature')
    assert.equal(fSnap.totals.activeCardCount, 4);
    assert.equal(fSnap.totals.matchingCardCount, 2);

    // 3. Sibling project privacy: outsider receives 404
    const outsiderRes = await app.request(`/api/v1/boards/${createdBoardId}`, {
      headers: { Cookie: eveCookie },
    });
    assert.equal(outsiderRes.status, 404);
  });

  // ==========================================================================
  // BRD-07: Paginated cards query & canonical position order
  // ==========================================================================
  await t.test('BRD-07: Paginated cards query with cursor resumption and filters', async () => {
    // Use createdBoardId with cards seeded above
    // Filter by priority=urgent, limit=1
    const page1Res = await app.request(
      `/api/v1/boards/${createdBoardId}/cards?priority=urgent&limit=1`,
      { headers: { Cookie: daveCookie } },
    );
    assert.equal(page1Res.status, 200);
    const page1Json = await page1Res.json();
    cardListResponseSchema.parse(page1Json);

    assert.equal(page1Json.data.length, 1);
    assert.equal(page1Json.data[0].id, 'c_snap_1');
    assert.ok(page1Json.nextCursor, 'Must have nextCursor');

    // Resume next page with cursor
    const page2Res = await app.request(
      `/api/v1/boards/${createdBoardId}/cards?priority=urgent&limit=1&cursor=${page1Json.nextCursor}`,
      { headers: { Cookie: daveCookie } },
    );
    assert.equal(page2Res.status, 200);
    const page2Json = await page2Res.json();
    assert.equal(page2Json.data.length, 1);
    assert.equal(page2Json.data[0].id, 'c_snap_3');
    assert.equal(page2Json.nextCursor, null);

    // Filter by due=overdue
    const overdueRes = await app.request(
      `/api/v1/boards/${createdBoardId}/cards?due=overdue`,
      { headers: { Cookie: daveCookie } },
    );
    assert.equal(overdueRes.status, 200);
    const overdueJson = await overdueRes.json();
    // c_snap_1 due in 2020 and column is 'todo' (not 'done') -> overdue!
    assert.equal(overdueJson.data.length, 1);
    assert.equal(overdueJson.data[0].id, 'c_snap_1');

    // Stale/malformed cursor returns 409 STALE_CURSOR
    const staleCurRes = await app.request(
      `/api/v1/boards/${createdBoardId}/cards?cursor=malformed_not_base64_json`,
      { headers: { Cookie: daveCookie } },
    );
    assert.equal(staleCurRes.status, 409);
    const staleCurJson = await staleCurRes.json();
    assert.equal(staleCurJson.error.code, 'STALE_CURSOR');

    // Filter mismatch cursor returns 409 STALE_CURSOR (F-04)
    const filterMismatchRes = await app.request(
      `/api/v1/boards/${createdBoardId}/cards?priority=high&cursor=${page1Json.nextCursor}`,
      { headers: { Cookie: daveCookie } },
    );
    assert.equal(filterMismatchRes.status, 409);
    assert.equal((await filterMismatchRes.json()).error.code, 'STALE_CURSOR');

    // A cursor from one board cannot be replayed against another board in the same project.
    const otherBoardId = 'brd_cursor_other';
    await pool.query(
      `INSERT INTO boards (id, workspace_id, project_id, name, structure_version, snapshot_version, archived, created_at, updated_at)
       VALUES ($1, $2, $3, 'Other board', 1, 1, FALSE, NOW(), NOW())`,
      [otherBoardId, workspaceId, projectAId],
    );
    await pool.query(
      `INSERT INTO board_grants (workspace_id, project_id, board_id, user_id, granted_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [workspaceId, projectAId, otherBoardId, daveViewerId, aliceOwnerId],
    );
    const otherBoardCursorRes = await app.request(
      `/api/v1/boards/${otherBoardId}/cards?priority=urgent&limit=1&cursor=${page1Json.nextCursor}`,
      { headers: { Cookie: daveCookie } },
    );
    assert.equal(otherBoardCursorRes.status, 409);
    assert.equal((await otherBoardCursorRes.json()).error.code, 'STALE_CURSOR');

    // A real ordering change between pages invalidates the old cursor.
    await pool.query("UPDATE cards SET position = position + 10000 WHERE id = 'c_snap_2'");
    await pool.query(
      'UPDATE boards SET structure_version = structure_version + 1, snapshot_version = snapshot_version + 1 WHERE id = $1',
      [createdBoardId],
    );
    const staleVersionRes = await app.request(
      `/api/v1/boards/${createdBoardId}/cards?priority=urgent&limit=1&cursor=${page1Json.nextCursor}`,
      { headers: { Cookie: daveCookie } },
    );
    assert.equal(staleVersionRes.status, 409);
    assert.equal((await staleVersionRes.json()).error.code, 'STALE_CURSOR');
  });
});
