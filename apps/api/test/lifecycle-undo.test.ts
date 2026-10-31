import assert from 'node:assert/strict';
import { insertWorkspaceForCookie } from './support/workspace-fixture.ts';
import test, { before, after } from 'node:test';
import crypto from 'node:crypto';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createApp } from '../src/http/app.ts';
import { getPool, closePool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';

test('PRJ-04, BRD-08, CRD-12: Project Archiving, Board Archiving & Move Undo Suite', async (t) => {
  const pool = getPool();
  const app = createApp();

  let owner: { cookie: string; user: { id: string; email: string; displayName: string } };
  let manager: { cookie: string; user: { id: string; email: string; displayName: string } };
  let member: { cookie: string; user: { id: string; email: string; displayName: string } };
  let outsider: { cookie: string; user: { id: string; email: string; displayName: string } };

  let workspaceId = '';
  let projectId = '';
  let boardId = '';
  let col1Id = '';
  let col2Id = '';
  let cardId = '';
  let keyCounter = 0;

  function nextKey(prefix = 'lifecycle-undo'): string {
    keyCounter++;
    return `idem_${prefix}_${Date.now()}_${keyCounter.toString().padStart(6, '0')}`;
  }

  before(async () => {
    await runMigrations(pool);

    const devOwner = await createDevUserAndSession(`owner-${Date.now()}@example.com`, 'Project Owner');
    owner = {
      cookie: `flowboard_session=${devOwner.session.id}`,
      user: devOwner.user,
    };

    const devManager = await createDevUserAndSession(`mgr-${Date.now()}@example.com`, 'Project Manager');
    manager = {
      cookie: `flowboard_session=${devManager.session.id}`,
      user: devManager.user,
    };

    const devMember = await createDevUserAndSession(`mem-${Date.now()}@example.com`, 'Project Member');
    member = {
      cookie: `flowboard_session=${devMember.session.id}`,
      user: devMember.user,
    };

    const devOutsider = await createDevUserAndSession(`outsider-${Date.now()}@example.com`, 'Outsider');
    outsider = {
      cookie: `flowboard_session=${devOutsider.session.id}`,
      user: devOutsider.user,
    };

    // 1. Create Workspace
    // B-20: POST /api/v1/workspaces is retired; the fixture inserts the owner's workspace.
    workspaceId = (await insertWorkspaceForCookie(owner.cookie, { name: 'Archiving Test Workspace' })).id;

    // 2. Create Project
    const prjRes = await app.request(`/api/v1/workspaces/${workspaceId}/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': nextKey('prj-create'),
      },
      body: JSON.stringify({
        name: 'Archiving Test Project',
        description: 'Testing project and board lifecycle',
      }),
    });
    assert.equal(prjRes.status, 201);
    const prjJson = (await prjRes.json()) as any;
    projectId = prjJson.data.id;

    // 3. Add Manager and Member
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'manager', 'active', NOW(), NOW()),
                ($5, $2, $3, $6, 'member', 'active', NOW(), NOW())`,
        [
          'pm_' + crypto.randomUUID(),
          projectId,
          workspaceId,
          manager.user.id,
          'pm_' + crypto.randomUUID(),
          member.user.id,
        ],
      );
    } finally {
      client.release();
    }

    // 4. Create Board
    const brdRes = await app.request(`/api/v1/projects/${projectId}/boards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': manager.cookie,
        'Idempotency-Key': nextKey('brd-create'),
      },
      body: JSON.stringify({
        name: 'Sprint Board',
      }),
    });
    assert.equal(brdRes.status, 201);
    const brdJson = (await brdRes.json()) as any;
    boardId = brdJson.data.id;

    await pool.query(
      `INSERT INTO board_grants (workspace_id, project_id, board_id, user_id, granted_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [workspaceId, projectId, boardId, member.user.id, owner.user.id],
    );

    // 5. Fetch columns created with board
    const colsRes = await pool.query<{ id: string; name: string }>(
      'SELECT id, name FROM columns WHERE board_id = $1 ORDER BY position ASC',
      [boardId],
    );
    assert.ok(colsRes.rows.length >= 2);
    col1Id = colsRes.rows[0]!.id;
    col2Id = colsRes.rows[1]!.id;

    // 6. Create Card in Col1
    const bVer = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const cardRes = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('card-create'),
      },
      body: JSON.stringify({
        columnId: col1Id,
        title: 'Move and Undo Task',
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

  await t.test('CRD-12: Move undo reverts move and respects OCC version conflict', async () => {
    // 1. Move card from Col1 to Col2
    const bVer1 = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const moveRes = await app.request(`/api/v1/cards/${cardId}/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('card-move-1'),
      },
      body: JSON.stringify({
        toColumnId: col2Id,
        previousCardId: null,
        nextCardId: null,
        expectedVersion: 1,
        expectedBoardVersion: bVer1.rows[0]!.structure_version,
      }),
    });
    assert.equal(moveRes.status, 200);

    // Verify card is now in Col2 with version 2
    const cCheck1 = await pool.query<{ column_id: string; version: number }>('SELECT column_id, version FROM cards WHERE id = $1', [cardId]);
    assert.equal(cCheck1.rows[0]?.column_id, col2Id);
    assert.equal(cCheck1.rows[0]?.version, 2);

    // 2. Undo move: card moves back from Col2 to Col1
    const bVer2 = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const undoKey = nextKey('card-undo-1');
    const undoRes = await app.request(`/api/v1/cards/${cardId}/move-undo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': undoKey,
      },
      body: JSON.stringify({
        expectedVersion: 2,
        expectedBoardVersion: bVer2.rows[0]!.structure_version,
      }),
    });
    assert.equal(undoRes.status, 200);

    // Verify card is back in Col1 with version 3
    const cCheck2 = await pool.query<{ column_id: string; version: number }>('SELECT column_id, version FROM cards WHERE id = $1', [cardId]);
    assert.equal(cCheck2.rows[0]?.column_id, col1Id);
    assert.equal(cCheck2.rows[0]?.version, 3);

    // 3. Idempotency replay on move-undo returns replayed: true
    const replayUndoRes = await app.request(`/api/v1/cards/${cardId}/move-undo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': undoKey,
      },
      body: JSON.stringify({
        expectedVersion: 2,
        expectedBoardVersion: bVer2.rows[0]!.structure_version,
      }),
    });
    assert.equal(replayUndoRes.status, 200);
    const replayUndoJson = (await replayUndoRes.json()) as any;
    assert.equal(replayUndoJson.replayed, true);

    // 4. Stale version conflict: trying to undo with stale expectedVersion returns 409 STALE_VERSION
    const staleUndoRes = await app.request(`/api/v1/cards/${cardId}/move-undo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('stale-undo'),
      },
      body: JSON.stringify({
        expectedVersion: 2, // actual is now 3
        expectedBoardVersion: bVer2.rows[0]!.structure_version,
      }),
    });
    assert.equal(staleUndoRes.status, 409);
  });

  await t.test('BRD-08: Archive and reopen board makes board read-only and resumes writes on reopen', async () => {
    // 1. Non-manager/non-owner receives 403 FORBIDDEN when archiving board
    const badArchRes = await app.request(`/api/v1/boards/${boardId}/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('bad-arch-brd'),
      },
    });
    assert.equal(badArchRes.status, 403);

    // 2. Project Manager archives board successfully
    const archKey = nextKey('arch-brd-mgr');
    const archRes = await app.request(`/api/v1/boards/${boardId}/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': manager.cookie,
        'Idempotency-Key': archKey,
      },
    });
    assert.equal(archRes.status, 200);
    const archJson = (await archRes.json()) as any;
    assert.equal(archJson.data.isArchived, true);

    // 3. Idempotency replay on archive returns replayed: true
    const replayArchRes = await app.request(`/api/v1/boards/${boardId}/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': manager.cookie,
        'Idempotency-Key': archKey,
      },
    });
    assert.equal(replayArchRes.status, 200);
    const replayArchJson = (await replayArchRes.json()) as any;
    assert.equal(replayArchJson.replayed, true);

    // 4. Writes on archived board are rejected with 409 READ_ONLY_CONTEXT
    const bVer = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const blockedWriteRes = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('blocked-card-create'),
      },
      body: JSON.stringify({
        columnId: col1Id,
        title: 'Should Be Blocked',
        expectedBoardVersion: bVer.rows[0]!.structure_version,
      }),
    });
    assert.equal(blockedWriteRes.status, 409);
    const blockedJson = (await blockedWriteRes.json()) as any;
    assert.equal(blockedJson.error?.code, 'READ_ONLY_CONTEXT');

    // 5. Existing cards on board remain readable via GET
    const getRes = await app.request(`/api/v1/cards/${cardId}`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(getRes.status, 200);

    // 6. Reopen board as manager
    const reopenRes = await app.request(`/api/v1/boards/${boardId}/reopen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': manager.cookie,
        'Idempotency-Key': nextKey('reopen-brd'),
      },
    });
    assert.equal(reopenRes.status, 200);
    const reopenJson = (await reopenRes.json()) as any;
    assert.equal(reopenJson.data.isArchived, false);

    // 7. Writes succeed again after reopening
    const bVerAfter = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const writeOkRes = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('card-create-after-reopen'),
      },
      body: JSON.stringify({
        columnId: col1Id,
        title: 'Allowed After Reopen',
        expectedBoardVersion: bVerAfter.rows[0]!.structure_version,
      }),
    });
    assert.equal(writeOkRes.status, 201);
  });

  await t.test('PRJ-04: Archive and reopen project makes project read-only and resumes writes on reopen', async () => {
    // 1. Manager receives 403 FORBIDDEN when attempting to archive project (Owner only)
    const badPrjArchRes = await app.request(`/api/v1/projects/${projectId}/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': manager.cookie,
        'Idempotency-Key': nextKey('bad-arch-prj'),
      },
    });
    assert.equal(badPrjArchRes.status, 403);

    // 2. Outsider receives 404 NOT_FOUND
    const outArchRes = await app.request(`/api/v1/projects/${projectId}/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': outsider.cookie,
        'Idempotency-Key': nextKey('out-arch-prj'),
      },
    });
    assert.equal(outArchRes.status, 404);

    // 3. Workspace Owner archives project
    const prjArchKey = nextKey('prj-arch-owner');
    const prjArchRes = await app.request(`/api/v1/projects/${projectId}/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': prjArchKey,
      },
    });
    assert.equal(prjArchRes.status, 200);
    const prjArchJson = (await prjArchRes.json()) as any;
    assert.equal(prjArchJson.data.isArchived, true);

    // 4. Writes in archived project are rejected with 409 READ_ONLY_CONTEXT
    const bVer = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const blockedPrjWriteRes = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('blocked-prj-card-create'),
      },
      body: JSON.stringify({
        columnId: col1Id,
        title: 'Blocked By Project Archive',
        expectedBoardVersion: bVer.rows[0]!.structure_version,
      }),
    });
    assert.equal(blockedPrjWriteRes.status, 409);
    const blockedPrjJson = (await blockedPrjWriteRes.json()) as any;
    assert.equal(blockedPrjJson.error?.code, 'READ_ONLY_CONTEXT');

    // 5. Existing project data and history remain queryable via GET
    const getPrjRes = await app.request(`/api/v1/projects/${projectId}`, {
      headers: { 'Cookie': member.cookie },
    });
    assert.equal(getPrjRes.status, 200);

    // 6. Owner reopens project
    const reopenPrjRes = await app.request(`/api/v1/projects/${projectId}/reopen`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': owner.cookie,
        'Idempotency-Key': nextKey('reopen-prj'),
      },
    });
    assert.equal(reopenPrjRes.status, 200);
    const reopenPrjJson = (await reopenPrjRes.json()) as any;
    assert.equal(reopenPrjJson.data.isArchived, false);

    // 7. Writes succeed again after reopening project
    const bVerAfter = await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [boardId]);
    const writeOkRes = await app.request(`/api/v1/boards/${boardId}/cards`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': member.cookie,
        'Idempotency-Key': nextKey('card-create-after-prj-reopen'),
      },
      body: JSON.stringify({
        columnId: col1Id,
        title: 'Allowed After Project Reopen',
        expectedBoardVersion: bVerAfter.rows[0]!.structure_version,
      }),
    });
    assert.equal(writeOkRes.status, 201);
  });
});
