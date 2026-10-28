import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createSession } from '../src/adapters/session.ts';
import {
  cardSchema,
  cardSummarySchema,
  type Card,
  type CardSummary,
} from '@flowboard/contracts';

test('CRD-01 through CRD-11: Card Lifecycle, Movement, OCC & Discovery Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  const aliceUserId = 'usr_alice_owner_crd';
  const bobUserId = 'usr_bob_pm_crd';
  const charlieUserId = 'usr_charlie_member_crd';
  const dianaUserId = 'usr_diana_viewer_crd';
  const eveUserId = 'usr_eve_sibling_crd';
  const frankUserId = 'usr_frank_outsider_crd';
  const graceUserId = 'usr_grace_removed_crd';

  let aliceCookie = '';
  let bobCookie = '';
  let charlieCookie = '';
  let dianaCookie = '';
  let eveCookie = '';
  let frankCookie = '';

  const workspaceId = 'ws_crd_test';
  const foreignWorkspaceId = 'ws_crd_foreign';
  const projectAlphaId = 'prj_alpha_crd';
  const projectBetaId = 'prj_beta_crd';
  const foreignProjectId = 'prj_foreign_crd';

  const boardAlphaId = 'brd_alpha_crd';
  const boardBetaId = 'brd_beta_crd';

  const colTodoId = 'col_todo_crd';
  const colActiveId = 'col_active_crd';
  const colDoneId = 'col_done_crd';
  const colBetaId = 'col_beta_crd';

  let keyCounter = 1;
  function nextKey(): string {
    return `idem_key_crd_${(keyCounter++).toString().padStart(6, '0')}_test_abc`;
  }

  before(async () => {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query(
        'TRUNCATE workspaces, users, sessions, idempotency_receipts, projects, project_memberships, boards, columns, cards, card_assignees CASCADE;',
      );

      // 1. Seed Users
      const users = [
        { id: aliceUserId, email: 'alice.crd@flowboard.example', name: 'Alice Owner' },
        { id: bobUserId, email: 'bob.crd@flowboard.example', name: 'Bob PM' },
        { id: charlieUserId, email: 'charlie.crd@flowboard.example', name: 'Charlie Member' },
        { id: dianaUserId, email: 'diana.crd@flowboard.example', name: 'Diana Viewer' },
        { id: eveUserId, email: 'eve.crd@flowboard.example', name: 'Eve Sibling' },
        { id: frankUserId, email: 'frank.crd@flowboard.example', name: 'Frank Outsider' },
        { id: graceUserId, email: 'grace.crd@flowboard.example', name: 'Grace Removed' },
      ];

      for (const u of users) {
        await client.query(
          `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
           VALUES ($1, $2, $3, null, NOW(), NOW())`,
          [u.id, u.email, u.name],
        );
      }

      // 2. Create Sessions
      const sAlice = await createSession(aliceUserId, 24, client);
      aliceCookie = `flowboard_session=${sAlice.id}`;

      const sBob = await createSession(bobUserId, 24, client);
      bobCookie = `flowboard_session=${sBob.id}`;

      const sCharlie = await createSession(charlieUserId, 24, client);
      charlieCookie = `flowboard_session=${sCharlie.id}`;

      const sDiana = await createSession(dianaUserId, 24, client);
      dianaCookie = `flowboard_session=${sDiana.id}`;

      const sEve = await createSession(eveUserId, 24, client);
      eveCookie = `flowboard_session=${sEve.id}`;

      const sFrank = await createSession(frankUserId, 24, client);
      frankCookie = `flowboard_session=${sFrank.id}`;

      // 3. Workspaces: Alice owns ws_crd_test, Frank owns ws_crd_foreign
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
         VALUES ($1, 'CRD Workspace', 'UTC', $2, 1, NOW(), NOW()),
                ($3, 'Foreign Workspace', 'UTC', $4, 1, NOW(), NOW())`,
        [workspaceId, aliceUserId, foreignWorkspaceId, frankUserId],
      );

      // 4. Projects: Alpha and Beta in ws_crd_test, Foreign in ws_crd_foreign
      await client.query(
        `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at)
         VALUES ($1, $2, 'Project Alpha', 'Alpha description', FALSE, 1, NOW(), NOW()),
                ($3, $2, 'Project Beta', 'Beta description', FALSE, 1, NOW(), NOW()),
                ($4, $5, 'Foreign Project', 'Foreign description', FALSE, 1, NOW(), NOW())`,
        [projectAlphaId, workspaceId, projectBetaId, foreignProjectId, foreignWorkspaceId],
      );

      // 5. Project Memberships
      // Alpha: Bob (manager), Charlie (member), Diana (viewer), Grace (removed)
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ('pm_bob_alpha', $1, $2, $3, 'manager', 'active', 1, NOW(), NOW()),
                ('pm_charlie_alpha', $1, $2, $4, 'member', 'active', 1, NOW(), NOW()),
                ('pm_diana_alpha', $1, $2, $5, 'viewer', 'active', 1, NOW(), NOW()),
                ('pm_grace_alpha', $1, $2, $6, 'member', 'removed', 1, NOW(), NOW())`,
        [projectAlphaId, workspaceId, bobUserId, charlieUserId, dianaUserId, graceUserId],
      );

      // Beta: Eve (member)
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at)
         VALUES ('pm_eve_beta', $1, $2, $3, 'member', 'active', 1, NOW(), NOW())`,
        [projectBetaId, workspaceId, eveUserId],
      );

      // 6. Boards
      await client.query(
        `INSERT INTO boards (id, workspace_id, project_id, name, structure_version, snapshot_version, archived, created_at, updated_at)
         VALUES ($1, $2, $3, 'Alpha Main Board', 1, 1, FALSE, NOW(), NOW()),
                ($4, $2, $5, 'Beta Main Board', 1, 1, FALSE, NOW(), NOW())`,
        [boardAlphaId, workspaceId, projectAlphaId, boardBetaId, projectBetaId],
      );

      // 7. Columns for Board Alpha
      await client.query(
        `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'To Do', '#6b7280', 'todo', 0, 1, NOW(), NOW()),
                ($5, $2, $3, $4, 'In Progress', '#3b82f6', 'active', 1, 1, NOW(), NOW()),
                ($6, $2, $3, $4, 'Done', '#10b981', 'done', 2, 1, NOW(), NOW())`,
        [colTodoId, workspaceId, projectAlphaId, boardAlphaId, colActiveId, colDoneId],
      );

      // Column for Board Beta
      await client.query(
        `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'Beta Col', '#6b7280', 'todo', 0, 1, NOW(), NOW())`,
        [colBetaId, workspaceId, projectBetaId, boardBetaId],
      );

      // 8. Board Grants for Non-Owners
      await client.query(
        `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
         VALUES
           ($1, $2, $3, $4, $7),
           ($1, $2, $3, $5, $7),
           ($1, $2, $3, $6, $7),
           ($8, $9, $3, $10, $7)`,
        [
          boardAlphaId, projectAlphaId, workspaceId,
          bobUserId, charlieUserId, dianaUserId, aliceUserId,
          boardBetaId, projectBetaId, eveUserId,
        ],
      );
    } finally {
      client.release();
    }
  });

  after(async () => {
    await closePool();
  });

  let createdCard1Id = '';
  let createdCard2Id = '';
  let createdCard3Id = '';

  // ==========================================================================
  // CRD-01: Card Quick Creation
  // ==========================================================================
  await t.test('CRD-01: Quick creation, permissions, position ranks & board structure version', async () => {
    // 1. Workspace Owner creates card 1
    const res1 = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: aliceCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        title: 'Card 1 Title',
        columnId: colTodoId,
        expectedBoardVersion: 1,
      }),
    });
    assert.equal(res1.status, 201);
    const body1 = (await res1.json()) as { data: Card };
    assert.equal(body1.data.title, 'Card 1 Title');
    assert.equal(body1.data.position, 1000); // 0 + 1000
    assert.equal(body1.data.priority, 'none');
    assert.equal(body1.data.dueDate, null);
    assert.deepEqual(body1.data.assigneeIds, []);
    assert.equal(body1.data.version, 1);
    assert.equal(body1.data.state, 'active');
    createdCard1Id = body1.data.id;

    // Check board structure_version incremented to 2
    const bCheck1 = await pool.query<{ structure_version: number; snapshot_version: number }>(
      'SELECT structure_version, snapshot_version FROM boards WHERE id = $1',
      [boardAlphaId],
    );
    assert.equal(bCheck1.rows[0]?.structure_version, 2);
    assert.equal(bCheck1.rows[0]?.snapshot_version, 2);

    // 2. Project Manager (Bob) creates card 2
    const res2 = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: bobCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        title: 'Card 2 Title',
        columnId: colTodoId,
        expectedBoardVersion: 2,
      }),
    });
    assert.equal(res2.status, 201);
    const body2 = (await res2.json()) as { data: Card };
    assert.equal(body2.data.position, 2000); // 1000 + 1000
    createdCard2Id = body2.data.id;

    // 3. Project Member (Charlie) creates card 3
    const res3 = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        title: 'Card 3 Title',
        columnId: colTodoId,
        expectedBoardVersion: 3,
      }),
    });
    assert.equal(res3.status, 201);
    const body3 = (await res3.json()) as { data: Card };
    assert.equal(body3.data.position, 3000); // 2000 + 1000
    createdCard3Id = body3.data.id;

    // 4. Viewer (Diana) gets 403 FORBIDDEN
    const resViewer = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: dianaCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        title: 'Viewer Card',
        columnId: colTodoId,
        expectedBoardVersion: 4,
      }),
    });
    assert.equal(resViewer.status, 403);

    // 5. Outsider (Frank) gets 404 NOT_FOUND
    const resOutsider = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: frankCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        title: 'Outsider Card',
        columnId: colTodoId,
        expectedBoardVersion: 4,
      }),
    });
    assert.equal(resOutsider.status, 404);

    // 6. Stale expectedBoardVersion returns 409 STALE_BOARD_VERSION
    const resStale = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: aliceCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        title: 'Stale Card',
        columnId: colTodoId,
        expectedBoardVersion: 1, // Current is 4
      }),
    });
    assert.equal(resStale.status, 409);
    const staleBody = (await resStale.json()) as any;
    assert.equal(staleBody.error.code, 'STALE_BOARD_VERSION');
    assert.equal(staleBody.error.details.currentBoardVersion, 4);

    // 7. Column not belonging to board returns 422 VALIDATION_ERROR
    const resBadCol = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: aliceCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        title: 'Bad Col Card',
        columnId: colBetaId, // Belongs to Board Beta!
        expectedBoardVersion: 4,
      }),
    });
    assert.equal(resBadCol.status, 422);
  });

  // ==========================================================================
  // CRD-02: Compact Card Summary Schema & Lightweight Payload
  // ==========================================================================
  await t.test('CRD-02: Compact CardSummary representation and lightweight payload', async () => {
    const res = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'GET',
      headers: {
        cookie: charlieCookie,
      },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: CardSummary[] };
    assert.equal(body.data.length, 3);

    for (const card of body.data) {
      // Validate CardSummary schema
      const parseResult = cardSummarySchema.safeParse(card);
      assert.ok(parseResult.success, `CardSummary schema validation failed: ${JSON.stringify(parseResult)}`);
      // Lightweight payload: must NOT expose full description
      assert.equal((card as any).description, undefined);
    }
  });

  // ==========================================================================
  // CRD-03: Card Detail Query, Independent Authorization & People Display
  // ==========================================================================
  await t.test('CRD-03: Card detail entity, independent authorization & assignees PersonDisplay', async () => {
    // 1. Authorized member can view detail
    const res = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'GET',
      headers: {
        cookie: charlieCookie,
      },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: Card; people: any[] };
    assert.equal(body.data.id, createdCard1Id);
    assert.equal(body.data.title, 'Card 1 Title');
    assert.equal(body.data.state, 'active');
    assert.equal(typeof body.data.description, 'string');
    assert.ok(cardSchema.safeParse(body.data).success);

    // 2. Sibling project user (Eve) receives 404 NOT_FOUND
    const resEve = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'GET',
      headers: {
        cookie: eveCookie,
      },
    });
    assert.equal(resEve.status, 404);

    // 3. Outsider (Frank) receives 404 NOT_FOUND
    const resFrank = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'GET',
      headers: {
        cookie: frankCookie,
      },
    });
    assert.equal(resFrank.status, 404);

    // 4. Trashed card returns 404 to normal readers
    await pool.query("UPDATE cards SET state = 'trashed' WHERE id = $1", [createdCard3Id]);
    const resTrashed = await app.request(`/api/v1/cards/${createdCard3Id}`, {
      method: 'GET',
      headers: {
        cookie: charlieCookie,
      },
    });
    assert.equal(resTrashed.status, 404);
    // Restore card 3 for subsequent tests
    await pool.query("UPDATE cards SET state = 'active' WHERE id = $1", [createdCard3Id]);
  });

  // ==========================================================================
  // CRD-04: Edit Title and Description with OCC Check
  // ==========================================================================
  await t.test('CRD-04: Title & description bounds, OCC conflict (409 STALE_VERSION)', async () => {
    // 1. Successful update of title and description
    const res = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        title: 'Updated Card 1 Title',
        description: 'New detailed description content up to 20k chars',
        expectedVersion: 1,
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: Card };
    assert.equal(body.data.title, 'Updated Card 1 Title');
    assert.equal(body.data.description, 'New detailed description content up to 20k chars');
    assert.equal(body.data.version, 2);

    // 2. OCC conflict: providing stale expectedVersion (1 instead of 2) returns 409 STALE_VERSION
    const resConflict = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: bobCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        title: 'Concurrent Edit',
        expectedVersion: 1,
      }),
    });
    assert.equal(resConflict.status, 409);
    const conflictBody = (await resConflict.json()) as any;
    assert.equal(conflictBody.error.code, 'STALE_VERSION');
    assert.equal(conflictBody.error.details.currentVersion, 2);

    // 3. Title bounds: empty title fails with 422
    const resEmpty = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        title: '   ',
        expectedVersion: 2,
      }),
    });
    assert.equal(resEmpty.status, 422);

    // 4. Title bounds: > 200 chars fails with 422
    const resTooLong = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        title: 'A'.repeat(201),
        expectedVersion: 2,
      }),
    });
    assert.equal(resTooLong.status, 422);

    // 5. Description bounds: > 20,000 chars fails with 422
    const resDescTooLong = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        description: 'B'.repeat(20001),
        expectedVersion: 2,
      }),
    });
    assert.equal(resDescTooLong.status, 422);
  });

  // ==========================================================================
  // CRD-05: Priority & Gregorian Due Date Validation
  // ==========================================================================
  await t.test('CRD-05: Priority & Gregorian calendar date validation (leap years & month bounds)', async () => {
    // 1. Valid priority and valid Gregorian leap year date (2024-02-29)
    const resValid = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        priority: 'urgent',
        dueDate: '2024-02-29',
        expectedVersion: 2,
      }),
    });
    assert.equal(resValid.status, 200);
    const bodyValid = (await resValid.json()) as { data: Card };
    assert.equal(bodyValid.data.priority, 'urgent');
    assert.equal(bodyValid.data.dueDate, '2024-02-29');
    assert.equal(bodyValid.data.version, 3);

    // 2. Invalid leap year date: 2023-02-29 (2023 is not a leap year) must fail with 422
    const resInvalidLeap = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        dueDate: '2023-02-29',
        expectedVersion: 3,
      }),
    });
    assert.equal(resInvalidLeap.status, 422);

    // 3. Invalid month date: 2024-04-31 (April has 30 days) must fail with 422
    const resInvalidMonth = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        dueDate: '2024-04-31',
        expectedVersion: 3,
      }),
    });
    assert.equal(resInvalidMonth.status, 422);

    // 4. Invalid priority value returns 422
    const resBadPriority = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        priority: 'critical_emergency',
        expectedVersion: 3,
      }),
    });
    assert.equal(resBadPriority.status, 422);
  });

  // ==========================================================================
  // CRD-06: Teammate Assignment & Strict Membership Isolation
  // ==========================================================================
  await t.test('CRD-06: Assign active teammates, reject sibling/outsider/removed, max 20 limit', async () => {
    // 1. Assign active teammates: Workspace owner (Alice) and project manager (Bob)
    const resAssign = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        assigneeIds: [aliceUserId, bobUserId],
        expectedVersion: 3,
      }),
    });
    assert.equal(resAssign.status, 200);
    const bodyAssign = (await resAssign.json()) as { data: Card };
    assert.deepEqual(bodyAssign.data.assigneeIds.sort(), [aliceUserId, bobUserId].sort());
    assert.equal(bodyAssign.data.version, 4);

    // Check card detail includes PersonDisplay for assignees
    const resDetail = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'GET',
      headers: {
        cookie: charlieCookie,
      },
    });
    assert.equal(resDetail.status, 200);
    const bodyDetail = (await resDetail.json()) as { data: Card; people: any[] };
    assert.equal(bodyDetail.people.length, 2);
    const pIds = bodyDetail.people.map((p: any) => p.id);
    assert.ok(pIds.includes(aliceUserId));
    assert.ok(pIds.includes(bobUserId));

    // 2. Reject sibling user (Eve) with 422 VALIDATION_ERROR
    const resSibling = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        assigneeIds: [eveUserId],
        expectedVersion: 4,
      }),
    });
    assert.equal(resSibling.status, 422);

    // 3. Reject removed user (Grace) with 422 VALIDATION_ERROR
    const resRemoved = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        assigneeIds: [graceUserId],
        expectedVersion: 4,
      }),
    });
    assert.equal(resRemoved.status, 422);

    // 4. Reject outsider user (Frank) with 422 VALIDATION_ERROR
    const resOutsider = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        assigneeIds: [frankUserId],
        expectedVersion: 4,
      }),
    });
    assert.equal(resOutsider.status, 422);

    // 5. Duplicate assignee IDs rejected with 422
    const resDup = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        assigneeIds: [bobUserId, bobUserId],
        expectedVersion: 4,
      }),
    });
    assert.equal(resDup.status, 422);

    // 6. Max 20 assignees: 21 IDs rejected with 422
    const twentyOneIds = Array.from({ length: 21 }, (_, i) => `usr_mock_${i}`);
    const resMax20 = await app.request(`/api/v1/cards/${createdCard1Id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        assigneeIds: twentyOneIds,
        expectedVersion: 4,
      }),
    });
    assert.equal(resMax20.status, 422);
  });

  // ==========================================================================
  // CRD-07: Card Movement Across and Within Columns
  // ==========================================================================
  await t.test('CRD-07: Card movement, relative neighbor ranking, empty column, dual OCC', async () => {
    // Current boardAlpha structure_version is 4. Current card 1 version is 4.
    // 1. Move card 1 to empty destination column (colActiveId)
    const resMoveEmpty = await app.request(`/api/v1/cards/${createdCard1Id}/move`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        toColumnId: colActiveId,
        previousCardId: null,
        nextCardId: null,
        expectedVersion: 4,
        expectedBoardVersion: 4,
      }),
    });
    assert.equal(resMoveEmpty.status, 200);
    const bodyMoved1 = (await resMoveEmpty.json()) as { data: Card };
    assert.equal(bodyMoved1.data.columnId, colActiveId);
    assert.equal(bodyMoved1.data.position, 1000);
    assert.equal(bodyMoved1.data.version, 5);

    // Board structure_version is now 5.
    // 2. Move card 2 (currently in colTodo at pos 2000) to colActive at the top (before card 1)
    const resMoveTop = await app.request(`/api/v1/cards/${createdCard2Id}/move`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        toColumnId: colActiveId,
        previousCardId: null,
        nextCardId: createdCard1Id,
        expectedVersion: 1,
        expectedBoardVersion: 5,
      }),
    });
    assert.equal(resMoveTop.status, 200);
    const bodyMoved2 = (await resMoveTop.json()) as { data: Card };
    assert.equal(bodyMoved2.data.columnId, colActiveId);
    assert.equal(bodyMoved2.data.position, 500); // 1000 / 2
    assert.equal(bodyMoved2.data.version, 2);

    // Board structure_version is now 6.
    // 3. Move card 3 (currently in colTodo at pos 3000) to colActive at the bottom (after card 1)
    const resMoveBottom = await app.request(`/api/v1/cards/${createdCard3Id}/move`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        toColumnId: colActiveId,
        previousCardId: createdCard1Id,
        nextCardId: null,
        expectedVersion: 1,
        expectedBoardVersion: 6,
      }),
    });
    assert.equal(resMoveBottom.status, 200);
    const bodyMoved3 = (await resMoveBottom.json()) as { data: Card };
    assert.equal(bodyMoved3.data.columnId, colActiveId);
    assert.equal(bodyMoved3.data.position, 2000); // 1000 + 1000
    assert.equal(bodyMoved3.data.version, 2);

    // Current colActive order: card 2 (500), card 1 (1000), card 3 (2000).
    // Board structure_version is now 7.
    // 4. Move card 3 between card 2 and card 1: prev = card 2 (500), next = card 1 (1000)
    const resMoveBetween = await app.request(`/api/v1/cards/${createdCard3Id}/move`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        toColumnId: colActiveId,
        previousCardId: createdCard2Id,
        nextCardId: createdCard1Id,
        expectedVersion: 2,
        expectedBoardVersion: 7,
      }),
    });
    assert.equal(resMoveBetween.status, 200);
    const bodyMovedBetween = (await resMoveBetween.json()) as { data: Card };
    assert.equal(bodyMovedBetween.data.position, 750); // Math.floor((500 + 1000)/2)
    assert.equal(bodyMovedBetween.data.version, 3);

    // 5. Move to column on different board rejected with 422
    const resBadBoardCol = await app.request(`/api/v1/cards/${createdCard3Id}/move`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        toColumnId: colBetaId,
        previousCardId: null,
        nextCardId: null,
        expectedVersion: 3,
        expectedBoardVersion: 8,
      }),
    });
    assert.equal(resBadBoardCol.status, 422);

    // Invalid relative placement must be rejected without changing card state or board ordering.
    const invalidMoveCardId = 'crd_invalid_neighbors';
    await pool.query(
      `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, version, state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Invalid neighbor test', 'none', 4000, 1, 'active', NOW(), NOW())`,
      [invalidMoveCardId, workspaceId, projectAlphaId, boardAlphaId, colTodoId],
    );
    const bothNull = await app.request(`/api/v1/cards/${invalidMoveCardId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: charlieCookie, 'idempotency-key': nextKey() },
      body: JSON.stringify({
        toColumnId: colActiveId,
        previousCardId: null,
        nextCardId: null,
        expectedVersion: 1,
        expectedBoardVersion: 8,
      }),
    });
    assert.equal(bothNull.status, 422);
    const nonAdjacent = await app.request(`/api/v1/cards/${invalidMoveCardId}/move`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: charlieCookie, 'idempotency-key': nextKey() },
      body: JSON.stringify({
        toColumnId: colActiveId,
        previousCardId: createdCard2Id,
        nextCardId: createdCard1Id,
        expectedVersion: 1,
        expectedBoardVersion: 8,
      }),
    });
    assert.equal(nonAdjacent.status, 422);
    const invalidMoveState = await pool.query<{ column_id: string; position: number; version: number }>(
      'SELECT column_id, position, version FROM cards WHERE id = $1',
      [invalidMoveCardId],
    );
    assert.equal(invalidMoveState.rows[0]!.column_id, colTodoId);
    assert.equal(Number(invalidMoveState.rows[0]!.position), 4000);
    assert.equal(invalidMoveState.rows[0]!.version, 1);
    const invalidMoveBoardVersion = await pool.query<{ structure_version: number }>(
      'SELECT structure_version FROM boards WHERE id = $1',
      [boardAlphaId],
    );
    assert.equal(invalidMoveBoardVersion.rows[0]!.structure_version, 8);
  });

  // ==========================================================================
  // CRD-08 & CRD-09: Placement Query & Canonical Order Under Filtering
  // ==========================================================================
  await t.test('CRD-08 & CRD-09: Placement query for first, last, before, after and movingCard exclusion', async () => {
    // Current colActive order:
    // card 2 (500), card 3 (750), card 1 (1000)
    // Board structure_version is 8.

    // 1. Placement 'first'
    const resFirst = await app.request(
      `/api/v1/boards/${boardAlphaId}/columns/${colActiveId}/placement?movingCardId=${createdCard1Id}&at=first`,
      {
        method: 'GET',
        headers: { cookie: charlieCookie },
      },
    );
    assert.equal(resFirst.status, 200);
    const bodyFirst = (await resFirst.json()) as any;
    assert.equal(bodyFirst.data.previousCardId, null);
    assert.equal(bodyFirst.data.nextCardId, createdCard2Id);

    // 2. Placement 'last'
    const resLast = await app.request(
      `/api/v1/boards/${boardAlphaId}/columns/${colActiveId}/placement?movingCardId=${createdCard2Id}&at=last`,
      {
        method: 'GET',
        headers: { cookie: charlieCookie },
      },
    );
    assert.equal(resLast.status, 200);
    const bodyLast = (await resLast.json()) as any;
    assert.equal(bodyLast.data.previousCardId, createdCard1Id);
    assert.equal(bodyLast.data.nextCardId, null);

    // 3. Placement 'before' card 3
    const resBefore = await app.request(
      `/api/v1/boards/${boardAlphaId}/columns/${colActiveId}/placement?movingCardId=${createdCard1Id}&at=before&anchorCardId=${createdCard3Id}`,
      {
        method: 'GET',
        headers: { cookie: charlieCookie },
      },
    );
    assert.equal(resBefore.status, 200);
    const bodyBefore = (await resBefore.json()) as any;
    assert.equal(bodyBefore.data.previousCardId, createdCard2Id);
    assert.equal(bodyBefore.data.nextCardId, createdCard3Id);

    // 4. Placement 'after' card 2
    const resAfter = await app.request(
      `/api/v1/boards/${boardAlphaId}/columns/${colActiveId}/placement?movingCardId=${createdCard1Id}&at=after&anchorCardId=${createdCard2Id}`,
      {
        method: 'GET',
        headers: { cookie: charlieCookie },
      },
    );
    assert.equal(resAfter.status, 200);
    const bodyAfter = (await resAfter.json()) as any;
    assert.equal(bodyAfter.data.previousCardId, createdCard2Id);
    assert.equal(bodyAfter.data.nextCardId, createdCard3Id);

    // 5. Moving card itself is excluded: placement 'after' card 3 when moving card 1
    // Remaining in column: card 2, card 3. So after card 3, nextCardId must be null!
    const resExclusion = await app.request(
      `/api/v1/boards/${boardAlphaId}/columns/${colActiveId}/placement?movingCardId=${createdCard1Id}&at=after&anchorCardId=${createdCard3Id}`,
      {
        method: 'GET',
        headers: { cookie: charlieCookie },
      },
    );
    assert.equal(resExclusion.status, 200);
    const bodyExclusion = (await resExclusion.json()) as any;
    assert.equal(bodyExclusion.data.previousCardId, createdCard3Id);
    assert.equal(bodyExclusion.data.nextCardId, null);

    const missingMovingCard = await app.request(
      `/api/v1/boards/${boardAlphaId}/columns/${colActiveId}/placement?movingCardId=card_does_not_exist&at=first`,
      { headers: { cookie: charlieCookie } },
    );
    assert.equal(missingMovingCard.status, 404);

    await pool.query("UPDATE cards SET state = 'trashed' WHERE id = $1", [createdCard3Id]);
    const trashedMovingCard = await app.request(
      `/api/v1/boards/${boardAlphaId}/columns/${colActiveId}/placement?movingCardId=${createdCard3Id}&at=first`,
      { headers: { cookie: charlieCookie } },
    );
    assert.equal(trashedMovingCard.status, 404);
    await pool.query("UPDATE cards SET state = 'active' WHERE id = $1", [createdCard3Id]);

    const foreignBoardCardId = 'crd_placement_foreign_board';
    await pool.query(
      `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, version, state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Foreign board card', 'none', 1000, 1, 'active', NOW(), NOW())`,
      [foreignBoardCardId, workspaceId, projectBetaId, boardBetaId, colBetaId],
    );
    const foreignMovingCard = await app.request(
      `/api/v1/boards/${boardAlphaId}/columns/${colActiveId}/placement?movingCardId=${foreignBoardCardId}&at=first`,
      { headers: { cookie: charlieCookie } },
    );
    assert.equal(foreignMovingCard.status, 400);
    assert.equal((await foreignMovingCard.json()).error.code, 'INVALID_MOVING_CARD');
  });

  // ==========================================================================
  // CRD-10: Concurrent Edit & Move Conflicts (409 STALE_VERSION / STALE_BOARD_VERSION)
  // ==========================================================================
  await t.test('CRD-10: Concurrent edit conflict & concurrent move conflict error envelopes', async () => {
    // 1. Stale card move conflict: card 1 is version 5, pass version 4 -> 409 STALE_VERSION
    const resCardConflict = await app.request(`/api/v1/cards/${createdCard1Id}/move`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        toColumnId: colActiveId,
        previousCardId: null,
        nextCardId: null,
        expectedVersion: 4, // Current is 5
        expectedBoardVersion: 8,
      }),
    });
    assert.equal(resCardConflict.status, 409);
    const bodyC1 = (await resCardConflict.json()) as any;
    assert.equal(bodyC1.error.code, 'STALE_VERSION');
    assert.equal(bodyC1.error.details.currentVersion, 5);

    // 2. Stale board structure move conflict: card 1 version 5 is correct, but expectedBoardVersion 7 is stale (current is 8)
    const resBoardConflict = await app.request(`/api/v1/cards/${createdCard1Id}/move`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        toColumnId: colActiveId,
        previousCardId: null,
        nextCardId: null,
        expectedVersion: 5,
        expectedBoardVersion: 7, // Current is 8
      }),
    });
    assert.equal(resBoardConflict.status, 409);
    const bodyB1 = (await resBoardConflict.json()) as any;
    assert.equal(bodyB1.error.code, 'STALE_BOARD_VERSION');
    assert.equal(bodyB1.error.details.currentBoardVersion, 8);
  });

  // ==========================================================================
  // CRD-11: Idempotent Mutations & Validation Error Formatting
  // ==========================================================================
  await t.test('CRD-11: Mandatory Idempotency-Key, exact replay, conflict detection & 422 error details', async () => {
    // 1. Missing Idempotency-Key header on create -> 400 IDEMPOTENCY_KEY_REQUIRED
    const resNoKey = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
      },
      body: JSON.stringify({
        title: 'No Idempotency Key',
        columnId: colTodoId,
        expectedBoardVersion: 8,
      }),
    });
    assert.equal(resNoKey.status, 400);
    const bodyNoKey = (await resNoKey.json()) as any;
    assert.equal(bodyNoKey.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

    // 2. Initial create with unique Idempotency-Key -> 201
    const sharedKey = nextKey();
    const payload = {
      title: 'Idempotent Card',
      columnId: colTodoId,
      expectedBoardVersion: 8,
    };

    const resFirst = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': sharedKey,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(resFirst.status, 201);
    const bodyFirst = (await resFirst.json()) as { data: Card };
    const initialCardId = bodyFirst.data.id;

    // 3. Replay with identical key & body -> 201 with replayed: true and SAME card ID
    const resReplay = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': sharedKey,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(resReplay.status, 201);
    const bodyReplay = (await resReplay.json()) as any;
    assert.equal(bodyReplay.replayed, true);
    assert.equal(bodyReplay.data.id, initialCardId);

    // 4. Replay with SAME key but DIFFERENT payload -> 409 IDEMPOTENCY_CONFLICT
    const resPayloadConflict = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': sharedKey,
      },
      body: JSON.stringify({
        title: 'Tampered Title with Same Key',
        columnId: colTodoId,
        expectedBoardVersion: 8,
      }),
    });
    assert.equal(resPayloadConflict.status, 409);
    const bodyConflict = (await resPayloadConflict.json()) as any;
    assert.equal(bodyConflict.error.code, 'IDEMPOTENCY_CONFLICT');

    // 5. Field validation error formatting: invalid fields return 422 VALIDATION_ERROR with structured issues
    const resValidation = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': nextKey(),
      },
      body: JSON.stringify({
        title: '', // Empty title
        columnId: colTodoId,
        expectedBoardVersion: 9,
      }),
    });
    assert.equal(resValidation.status, 422);
    const valBody = (await resValidation.json()) as any;
    assert.equal(valBody.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(valBody.error.details.issues));
  });

  // ==========================================================================
  // Project Search & My Tasks Discovery (QRY-03)
  // ==========================================================================
  await t.test('Discovery: Search project cards & My Tasks assigned view', async () => {
    // 1. Search project cards: substring search 'Card 1'
    const resSearch = await app.request(
      `/api/v1/projects/${projectAlphaId}/cards/search?query=Card%201`,
      {
        method: 'GET',
        headers: { cookie: charlieCookie },
      },
    );
    assert.equal(resSearch.status, 200);
    const searchBody = (await resSearch.json()) as { data: CardSummary[] };
    assert.ok(searchBody.data.length >= 1);
    assert.ok(searchBody.data.some((c) => c.id === createdCard1Id));

    // 2. Outsider (Frank) cannot search project cards -> 404 NOT_FOUND
    const resSearchOutsider = await app.request(
      `/api/v1/projects/${projectAlphaId}/cards/search?query=Card`,
      {
        method: 'GET',
        headers: { cookie: frankCookie },
      },
    );
    assert.equal(resSearchOutsider.status, 404);

    // 3. My Tasks for Bob (who was assigned to Card 1)
    const resMyTasks = await app.request(`/api/v1/me/tasks?projectId=${projectAlphaId}`, {
      method: 'GET',
      headers: { cookie: bobCookie },
    });
    assert.equal(resMyTasks.status, 200);
    const tasksBody = (await resMyTasks.json()) as { data: CardSummary[] };
    assert.ok(tasksBody.data.some((c) => c.id === createdCard1Id));

    // 4. My Tasks for Frank: project membership is required, even when no
    // assignments would match. Keep project existence private.
    const resFrankTasks = await app.request(`/api/v1/me/tasks?projectId=${projectAlphaId}`, {
      method: 'GET',
      headers: { cookie: frankCookie },
    });
    assert.equal(resFrankTasks.status, 404);
    assert.equal((await resFrankTasks.json() as any).error.code, 'NOT_FOUND');

    // 5. Overdue search: excludes cards in 'done' category column (F-03)
    const overdueCardTodoId = 'crd_overdue_todo';
    const overdueCardDoneId = 'crd_overdue_done';
    await pool.query(
      `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, due_date, position, version, state, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Overdue In Todo', 'none', '2020-01-01', 8000, 1, 'active', NOW(), NOW()),
              ($6, $2, $3, $4, $7, 'Overdue In Done', 'none', '2020-01-01', 9000, 1, 'active', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [overdueCardTodoId, workspaceId, projectAlphaId, boardAlphaId, colTodoId, overdueCardDoneId, colDoneId],
    );

    const resOverdue = await app.request(
      `/api/v1/projects/${projectAlphaId}/cards/search?due=overdue`,
      {
        method: 'GET',
        headers: { cookie: charlieCookie },
      },
    );
    assert.equal(resOverdue.status, 200);
    const overdueBody = (await resOverdue.json()) as { data: CardSummary[] };
    assert.ok(overdueBody.data.some((c) => c.id === overdueCardTodoId), 'Overdue card in Todo must be found');
    assert.ok(!overdueBody.data.some((c) => c.id === overdueCardDoneId), 'Card in Done column must NOT be overdue');
  });

  await t.test('CRD-11: Receipt replay rechecks current role and stores only a minimal outcome', async () => {
    const boardVersion = await pool.query<{ structure_version: number }>(
      'SELECT structure_version FROM boards WHERE id = $1',
      [boardAlphaId],
    );
    const key = 'idem_crd_revoked_minimal_receipt_001';
    const privateTitle = 'Receipt must not retain this private title';
    const payload = {
      title: privateTitle,
      columnId: colTodoId,
      expectedBoardVersion: boardVersion.rows[0]!.structure_version,
    };
    const created = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: charlieCookie,
        'idempotency-key': key,
      },
      body: JSON.stringify(payload),
    });
    assert.equal(created.status, 201);
    const createdBody = (await created.json()) as { data: Card };

    const receipt = await pool.query<{ response_body: unknown }>(
      'SELECT response_body FROM idempotency_receipts WHERE actor_id = $1 AND scope_id = $2 AND idempotency_key = $3',
      [charlieUserId, projectAlphaId, key],
    );
    assert.equal(receipt.rows.length, 1);
    assert.equal(JSON.stringify(receipt.rows[0]!.response_body).includes(privateTitle), false);
    assert.deepEqual(receipt.rows[0]!.response_body, {
      data: {
        id: createdBody.data.id,
        projectId: projectAlphaId,
        state: 'active',
        version: createdBody.data.version,
        workspaceId,
      },
    });

    await pool.query(
      `UPDATE project_memberships SET role = 'viewer' WHERE project_id = $1 AND user_id = $2`,
      [projectAlphaId, charlieUserId],
    );
    try {
      const replay = await app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: charlieCookie,
          'idempotency-key': key,
        },
        body: JSON.stringify(payload),
      });
      assert.equal(replay.status, 403);
    } finally {
      await pool.query(
        `UPDATE project_memberships SET role = 'member' WHERE project_id = $1 AND user_id = $2`,
        [projectAlphaId, charlieUserId],
      );
    }
  });

  await t.test('CRD-11: Parallel same-key creates commit one card and replay its identifier', async () => {
    const boardVersion = await pool.query<{ structure_version: number }>(
      'SELECT structure_version FROM boards WHERE id = $1',
      [boardAlphaId],
    );
    const key = 'idem_crd_parallel_same_key_001';
    const payload = JSON.stringify({
      title: 'One logical card from concurrent retries',
      columnId: colTodoId,
      expectedBoardVersion: boardVersion.rows[0]!.structure_version,
    });
    const [first, second] = await Promise.all([
      app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: charlieCookie, 'idempotency-key': key },
        body: payload,
      }),
      app.request(`/api/v1/boards/${boardAlphaId}/cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: charlieCookie, 'idempotency-key': key },
        body: payload,
      }),
    ]);
    assert.deepEqual([first.status, second.status], [201, 201]);
    const [firstBody, secondBody] = await Promise.all([first.json(), second.json()]) as [{
      data: { id: string };
      replayed?: boolean;
    }, {
      data: { id: string };
      replayed?: boolean;
    }];
    assert.equal(firstBody.data.id, secondBody.data.id);
    assert.equal([firstBody.replayed, secondBody.replayed].filter(Boolean).length, 1);

    const count = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::integer AS count FROM cards WHERE project_id = $1 AND title = $2`,
      [projectAlphaId, 'One logical card from concurrent retries'],
    );
    assert.equal(count.rows[0]!.count, 1);
  });

  await t.test('CRD-11: Card update and move receipt replay serialize with trash on separate DB connections', async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    async function verifyLifecycleRace(action: 'update' | 'move'): Promise<void> {
      const cardId = `crd_replay_trash_race_${action}`;
      const key = `idem_replay_trash_race_${action}`;
      await pool.query(
        `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, priority, position, version, state, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'Replay race card', 'none', 900000, 1, 'active', NOW(), NOW())`,
        [cardId, workspaceId, projectAlphaId, boardAlphaId, colTodoId],
      );

      let commandBody: Record<string, unknown>;
      let commandPath: string;
      let commandMethod: string;
      if (action === 'update') {
        commandPath = `/api/v1/cards/${cardId}`;
        commandMethod = 'PATCH';
        commandBody = { title: 'Replay race card updated', expectedVersion: 1 };
      } else {
        const neighbors = await pool.query<{ id: string }>(
          `SELECT id FROM cards WHERE column_id = $1 AND state = 'active' AND id != $2 ORDER BY position ASC, id ASC`,
          [colTodoId, cardId],
        );
        commandPath = `/api/v1/cards/${cardId}/move`;
        commandMethod = 'POST';
        commandBody = {
          toColumnId: colTodoId,
          previousCardId: neighbors.rows.at(-1)?.id ?? null,
          nextCardId: null,
          expectedVersion: 1,
          expectedBoardVersion: (await pool.query<{ structure_version: number }>(
            'SELECT structure_version FROM boards WHERE id = $1', [boardAlphaId],
          )).rows[0]!.structure_version,
        };
      }

      const firstWrite = await app.request(commandPath, {
        method: commandMethod,
        headers: { 'content-type': 'application/json', cookie: charlieCookie, 'idempotency-key': key },
        body: JSON.stringify(commandBody),
      });
      assert.equal(firstWrite.status, 200);

      const state = await pool.query<{ version: number; structure_version: number }>(
        `SELECT c.version, b.structure_version FROM cards c JOIN boards b ON b.id = c.board_id WHERE c.id = $1`,
        [cardId],
      );

      // Hold the same row lock as a request inside its replay transaction. Trash must wait.
      const locker = await pool.connect();
      let trashPromise: Promise<Response> | undefined;
      try {
        await locker.query('BEGIN');
        await locker.query('SELECT id FROM cards WHERE id = $1 FOR SHARE', [cardId]);
        trashPromise = Promise.resolve(app.request(`/api/v1/cards/${cardId}/delete`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: bobCookie, 'idempotency-key': `idem_trash_race_${action}` },
          body: JSON.stringify({ expectedVersion: state.rows[0]!.version, expectedBoardVersion: state.rows[0]!.structure_version }),
        }));

        let observedLockWait = false;
        for (let attempt = 0; attempt < 50; attempt++) {
          const wait = await pool.query<{ waiting: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM pg_stat_activity
               WHERE datname = current_database() AND wait_event_type = 'Lock'
             ) AS waiting`,
          );
          if (wait.rows[0]!.waiting) {
            observedLockWait = true;
            break;
          }
          await delay(10);
        }
        assert.equal(observedLockWait, true, 'trash must wait for the replay/lifecycle row lock');
      } finally {
        await locker.query('COMMIT').catch(() => {});
        locker.release();
      }

      const trashed = await trashPromise!;
      assert.equal(trashed.status, 200);
      const retry = await app.request(commandPath, {
        method: commandMethod,
        headers: { 'content-type': 'application/json', cookie: charlieCookie, 'idempotency-key': key },
        body: JSON.stringify(commandBody),
      });
      assert.equal(retry.status, 404);
    }

    await verifyLifecycleRace('update');
    await verifyLifecycleRace('move');
  });
});
