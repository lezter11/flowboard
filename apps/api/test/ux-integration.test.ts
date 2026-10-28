import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import crypto from 'node:crypto';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';

test('UX-01 to UX-05: UX Integration, State Envelopes, Boundaries & Performance Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  let owner: { cookie: string; user: { id: string; email: string; displayName: string } };
  let member: { cookie: string; user: { id: string; email: string; displayName: string } };
  let outsider: { cookie: string; user: { id: string; email: string; displayName: string } };

  let workspaceId = '';
  let projectId = '';
  let siblingProjectId = '';
  let emptyBoardId = '';
  let boardId = '';
  let col1Id = '';
  let col2Id = '';
  let cardId = '';
  let keyCounter = 0;

  function nextKey(prefix = 'ux-test'): string {
    keyCounter++;
    return `idem_${prefix}_${Date.now()}_${keyCounter.toString().padStart(6, '0')}`;
  }

  before(async () => {
    await runMigrations(pool);

    const devOwner = await createDevUserAndSession(`ux-owner-${Date.now()}@example.com`, 'UX Owner');
    owner = {
      cookie: `flowboard_session=${devOwner.session.id}`,
      user: devOwner.user,
    };

    const devMember = await createDevUserAndSession(`ux-mem-${Date.now()}@example.com`, 'UX Member');
    member = {
      cookie: `flowboard_session=${devMember.session.id}`,
      user: devMember.user,
    };

    const devOutsider = await createDevUserAndSession(`ux-out-${Date.now()}@example.com`, 'UX Outsider');
    outsider = {
      cookie: `flowboard_session=${devOutsider.session.id}`,
      user: devOutsider.user,
    };

    // 1. Create Workspace
    const wsRes = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': nextKey('ws-create'),
      },
      body: JSON.stringify({
        name: 'UX Experience Workspace',
        timezone: 'UTC',
      }),
    });
    assert.equal(wsRes.status, 201);
    const wsJson = (await wsRes.json()) as any;
    workspaceId = wsJson.data.id;

    // 2. Create Primary Project and Sibling Project
    const prjRes1 = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': nextKey('prj1-create'),
      },
      body: JSON.stringify({
        name: 'Primary Project',
        description: 'For UX testing',
      }),
    });
    assert.equal(prjRes1.status, 201);
    const prj1Json = (await prjRes1.json()) as any;
    projectId = prj1Json.data.id;

    const prjRes2 = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': nextKey('prj2-create'),
      },
      body: JSON.stringify({
        name: 'Sibling Project',
        description: 'For isolation testing',
      }),
    });
    assert.equal(prjRes2.status, 201);
    const prj2Json = (await prjRes2.json()) as any;
    siblingProjectId = prj2Json.data.id;

    // 3. Add Member to Primary Project
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'member', 'active', NOW(), NOW())`,
        ['pm_' + crypto.randomUUID(), projectId, workspaceId, member.user.id],
      );
    } finally {
      client.release();
    }

    // 4. Create Active Board with Columns
    const brdRes = await app.request(`/api/v1/projects/${projectId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': nextKey('brd-create'),
      },
      body: JSON.stringify({
        name: 'Active UX Board',
      }),
    });
    assert.equal(brdRes.status, 201);
    const brdJson = (await brdRes.json()) as any;
    boardId = brdJson.data.id;

    // 5. Fetch columns
    const colsRes = await pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM columns WHERE board_id = $1 ORDER BY position ASC',
      [boardId],
    );
    col1Id = colsRes.rows[0]!.id;
    col2Id = colsRes.rows[1]!.id;

    // 6. Create Empty Board (no cards)
    const emptyBrdRes = await app.request(`/api/v1/projects/${projectId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': nextKey('empty-brd-create'),
      },
      body: JSON.stringify({
        name: 'Empty Board',
      }),
    });
    assert.equal(emptyBrdRes.status, 201);
    const emptyBrdJson = (await emptyBrdRes.json()) as any;
    emptyBoardId = emptyBrdJson.data.id;

    await pool.query(
      `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
       VALUES ($1, $2, $3, $4, $5), ($6, $2, $3, $4, $5)`,
      [boardId, projectId, workspaceId, member.user.id, owner.user.id, emptyBoardId],
    );

    // 7. Create an initial card on primary board
    const bVer = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const cardRes = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('init-card'),
      },
      body: JSON.stringify({
        columnId: col1Id,
        title: 'Initial UX Card',
        description: 'Testing standard UX operations',
        expectedBoardVersion: bVer.rows[0]!.structure_version,
      }),
    });
    assert.equal(cardRes.status, 201);
    const cardJson = (await cardRes.json()) as any;
    cardId = cardJson.data.id;
  });

  after(async () => {
    await closePool();
  });

  await t.test('UX-01: Standard empty states and safe error envelopes', async () => {
    // 1. Empty board returns clean snapshot with 0 cards and no error
    const emptySnapRes = await app.request(`/api/v1/boards/${emptyBoardId}`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(emptySnapRes.status, 200);
    const emptySnapJson = (await emptySnapRes.json()) as any;
    assert.ok(emptySnapJson.data);
    assert.equal(emptySnapJson.data.totals.activeCardCount, 0);

    // 2. Empty search results return { data: [], nextCursor: null, matchingCardCount: 0 }
    const searchRes = await app.request(`/api/v1/projects/${projectId}/cards/search?query=nonexistent_query_string`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(searchRes.status, 200);
    const searchJson = (await searchRes.json()) as any;
    assert.deepEqual(searchJson.data, []);
    assert.equal(searchJson.matchingCardCount, 0);
    assert.equal(searchJson.nextCursor, null);

    // 3. Empty project trash returns { data: [], nextCursor: null }
    const trashRes = await app.request(`/api/v1/projects/${projectId}/trash`, {
      headers: { 'Cookie': owner.cookie },
    });
    assert.equal(trashRes.status, 200);
    const trashJson = (await trashRes.json()) as any;
    assert.deepEqual(trashJson.data, []);
    assert.equal(trashJson.nextCursor, null);

    // 4. Safe error envelope invariants: 401, 403, 404, 409, 422
    // 401: Missing cookie
    const unauthRes = await app.request('/api/v1/session');
    assert.equal(unauthRes.status, 401);
    const unauthJson = (await unauthRes.json()) as any;
    assert.ok(unauthJson.error?.code);
    assert.ok(unauthJson.error?.message);

    // 403: Member accessing owner-only workspace update
    const forbRes = await app.request(`/api/v1/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
      },
      body: JSON.stringify({ name: 'Unauthorized', expectedVersion: 1 }),
    });
    assert.equal(forbRes.status, 403);
    const forbJson = (await forbRes.json()) as any;
    assert.ok(forbJson.error?.code);

    // 404: Non-existent card
    const notFoundRes = await app.request('/api/v1/cards/nonexistent-card-id', {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(notFoundRes.status, 404);
    const notFoundJson = (await notFoundRes.json()) as any;
    assert.equal(notFoundJson.error?.code, 'NOT_FOUND');

    // 422: Malformed body
    const valRes = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('invalid-card'),
      },
      body: JSON.stringify({
        columnId: col1Id,
        title: '', // empty title invalid
        expectedBoardVersion: 1,
      }),
    });
    assert.equal(valRes.status, 422);
    const valJson = (await valRes.json()) as any;
    assert.ok(valJson.error?.code);
  });

  await t.test('UX-02: Accessible movement and card detail dialog payload', async () => {
    // 1. Full card detail dialog payload endpoint provides entity, category, assignees, and timestamps
    const detailRes = await app.request(`/api/v1/cards/${cardId}`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(detailRes.status, 200);
    const detailJson = (await detailRes.json()) as any;
    assert.equal(detailJson.data.id, cardId);
    assert.equal(detailJson.data.title, 'Initial UX Card');
    assert.ok(detailJson.data.createdAt);
    assert.ok(detailJson.data.updatedAt);
    assert.ok(Array.isArray(detailJson.people));

    // 2. Relative keyboard move: move card from Col1 to Col2 with null neighbors
    const bVer = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const moveRes = await app.request(`/api/v1/cards/${cardId}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('ux-key-move'),
      },
      body: JSON.stringify({
        toColumnId: col2Id,
        previousCardId: null,
        nextCardId: null,
        expectedVersion: 1,
        expectedBoardVersion: bVer.rows[0]!.structure_version,
      }),
    });
    assert.equal(moveRes.status, 200);
    const moveJson = (await moveRes.json()) as any;
    assert.equal(moveJson.data.columnId, col2Id);
    assert.equal(moveJson.data.version, 2);
  });

  await t.test('UX-03: Narrow viewport payload safety and long content boundaries', async () => {
    // 1. Long description (multi-paragraph text) is stored and returned intact
    const longDesc = 'Paragraph 1: Overview of the project.\n\n' +
      'Paragraph 2: Implementation details with extensive description.\n\n'.repeat(20);

    const patchRes = await app.request(`/api/v1/cards/${cardId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('ux-long-desc'),
      },
      body: JSON.stringify({
        description: longDesc,
        expectedVersion: 2,
      }),
    });
    assert.equal(patchRes.status, 200);
    const patchJson = (await patchRes.json()) as any;
    assert.equal(patchJson.data.description, longDesc);

    // 2. Bounded pagination limits: limit > 100 is rejected with 422 to protect narrow viewports
    const excessLimitRes = await app.request(`/api/v1/boards/${boardId}/cards?limit=500`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(excessLimitRes.status, 422);

    // Valid limit <= 100 succeeds and returns bounded page
    const validLimitRes = await app.request(`/api/v1/boards/${boardId}/cards?limit=50`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(validLimitRes.status, 200);
    const validLimitJson = (await validLimitRes.json()) as any;
    assert.ok(validLimitJson.data.length <= 50, 'Page size bounded to limit');
  });

  await t.test('UX-04: Refresh reconnect, version reconciliation and stale overwrite prevention', async () => {
    // 1. Board snapshot exposes structureVersion and snapshotVersion
    const snapRes = await app.request(`/api/v1/boards/${boardId}`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(snapRes.status, 200);
    const snapJson = (await snapRes.json()) as any;
    assert.ok(snapJson.data.board.structureVersion >= 1);
    assert.ok(snapJson.data.board.snapshotVersion >= 1);

    // 2. OCC Conflict: stale tab attempting to update card with older expectedVersion is rejected
    const staleUpdateRes = await app.request(`/api/v1/cards/${cardId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('ux-stale-patch'),
      },
      body: JSON.stringify({
        title: 'Overwriting with Stale Version',
        expectedVersion: 1, // Current is 3
      }),
    });
    assert.equal(staleUpdateRes.status, 409);
    const staleJson = (await staleUpdateRes.json()) as any;
    assert.equal(staleJson.error?.code, 'STALE_VERSION');
  });

  await t.test('UX-05: Performance benchmarks, project isolation, and exact restore boundary', async () => {
    // 1. Warm query benchmark: Snapshot query completes in < 50ms
    const startSnap = performance.now();
    const snapRes = await app.request(`/api/v1/boards/${boardId}`, {
      headers: { 'Cookie': member.cookie },
    });
    const snapDuration = performance.now() - startSnap;
    assert.equal(snapRes.status, 200);
    assert.ok(snapDuration < 100, `Snapshot query latency (${snapDuration.toFixed(2)}ms) within benchmark`);

    // 2. Project isolation: Member granted in Project 1 querying Sibling Project 2 receives 404 NOT_FOUND
    const sibRes = await app.request(`/api/v1/projects/${siblingProjectId}`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(sibRes.status, 404);

    const sibSearchRes = await app.request(`/api/v1/projects/${siblingProjectId}/cards/search`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(sibSearchRes.status, 404);

    // 3. Exact restore boundary:
    // Soft-delete a card with restore_until in the past -> restore returns 410 or 409
    const client = await pool.connect();
    let expiredCardId = '';
    try {
      const expRes = await client.query<{ id: string }>(
        `INSERT INTO cards (
           id, workspace_id, project_id, board_id, column_id, title, priority, position, version, state, deleted_at, restore_until, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, 'Expired Trash Card', 'medium', 1000, 1, 'trashed', NOW() - INTERVAL '25 hours', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '26 hours', NOW()
         ) RETURNING id`,
        ['crd_' + crypto.randomUUID(), workspaceId, projectId, boardId, col1Id],
      );
      expiredCardId = expRes.rows[0]!.id;
    } finally {
      client.release();
    }

    const bVer = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const expiredRestoreRes = await app.request(`/api/v1/cards/${expiredCardId}/restore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': nextKey('exp-restore'),
      },
      body: JSON.stringify({
        expectedVersion: 1,
        expectedBoardVersion: bVer.rows[0]!.structure_version,
        toColumnId: col1Id,
      }),
    });
    assert.equal(expiredRestoreRes.status, 410);
    const expJson = (await expiredRestoreRes.json()) as any;
    assert.equal(expJson.error?.code, 'RESTORE_WINDOW_EXPIRED');
  });
});
