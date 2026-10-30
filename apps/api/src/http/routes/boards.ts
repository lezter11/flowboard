import { Hono } from 'hono';
import {
  createBoardInputSchema,
  updateBoardInputSchema,
  createColumnInputSchema,
  updateColumnInputSchema,
  reorderColumnsInputSchema,
  placementInputSchema,
  cardsQuerySchema,
  boardSnapshotQuerySchema,
  idempotencyKeySchema,
  parseOrThrow,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { checkOrReplayReceipt, checkOrReplayProjectWriteReceipt, saveReceipt } from '../../adapters/idempotency.ts';
import { acquireWriteGrantLock } from '../../adapters/rbac.ts';
import { recordActivity } from '../../adapters/activity.ts';
import { lockBoardAccess, lockProjectBoardReadScope } from '../../adapters/board-grants-foundation.ts';
import {
  createBoard,
  listProjectBoards,
  updateBoard,
  addColumn,
  updateColumn,
  reorderColumns,
  deleteColumn,
  getPlacement,
  getBoardSnapshot,
  listBoardCards,
} from '../../adapters/boards.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth.ts';

export const boardsRoutes = new Hono();

// Helper to require authenticated session actor
function getActorOrThrow(c: any) {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }
  return actor;
}

// 1. POST /api/v1/projects/:projectId/boards: Create board with default columns
boardsRoutes.post('/api/v1/projects/:projectId/boards', authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const projectId = c.req.param('projectId');

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const rawBody = await c.req.json();
  const body = parseOrThrow(createBoardInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const methodPath = `/api/v1/projects/${projectId}/boards`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'manager',
      idempotencyKey,
      methodPath,
      body,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const board = await createBoard(client, projectId, body.name, actor.id, body.description ?? null);
    const responsePayload = { data: board };

    const saved = await saveReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      body,
      201,
      responsePayload,
    );

    await client.query('COMMIT');

    if (saved?.replayed) {
      return c.json(
        { ...(saved.responseBody as object), replayed: true },
        saved.statusCode as any,
      );
    }

    return c.json(responsePayload, 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 2. GET /api/v1/projects/:projectId/boards: List active boards in project
boardsRoutes.get('/api/v1/projects/:projectId/boards', authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const projectId = c.req.param('projectId');

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const boardIds = await lockProjectBoardReadScope(client, projectId, actor.id);
    const result = await listProjectBoards(client, projectId, actor.id, boardIds);
    await client.query('COMMIT');
    return c.json(result, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

// 3. GET /api/v1/boards/:boardId: Get consistent bounded board snapshot
boardsRoutes.get('/api/v1/boards/:boardId', optionalAuthMiddleware, async (c) => {
  const boardId = c.req.param('boardId');
  const pool = getPool();

  // If the board does not exist at all, return 404 regardless of authentication
  const boardCheck = await pool.query<{ id: string }>('SELECT id FROM boards WHERE id = $1', [boardId]);
  if (boardCheck.rows.length === 0) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }

  const actor = getActorOrThrow(c);

  const queryParams = c.req.query();
  const parsedQuery = parseOrThrow(boardSnapshotQuerySchema, queryParams);

  const snapshot = await getBoardSnapshot(pool, boardId, actor.id, parsedQuery);
  return c.json({ data: snapshot }, 200);
});

// 4. PATCH /api/v1/boards/:boardId: Update board name and/or description with OCC (project owner only)
boardsRoutes.patch('/api/v1/boards/:boardId', authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param('boardId');

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const rawBody = await c.req.json();
  const body = parseOrThrow(updateBoardInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Fetch board project_id for receipt scoping
    const prjRes = await client.query<{ project_id: string }>(
      `SELECT project_id FROM boards WHERE id = $1`,
      [boardId],
    );
    if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
      throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
    const projectId = prjRes.rows[0].project_id;

    const methodPath = `/api/v1/boards/${boardId}`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'manager',
      idempotencyKey,
      methodPath,
      body,
      boardId,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const updatedBoard = await updateBoard(
      client,
      boardId,
      { name: body.name, description: body.description },
      body.expectedVersion,
      actor.id,
    );
    const responsePayload = { data: updatedBoard };

    const saved = await saveReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload,
    );

    await client.query('COMMIT');

    if (saved?.replayed) {
      return c.json(
        { ...(saved.responseBody as object), replayed: true },
        saved.statusCode as any,
      );
    }

    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 5. POST /api/v1/boards/:boardId/columns: Add column to board
boardsRoutes.post('/api/v1/boards/:boardId/columns', authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param('boardId');

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const rawBody = await c.req.json();
  const body = parseOrThrow(createColumnInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const prjRes = await client.query<{ project_id: string }>(
      `SELECT project_id FROM boards WHERE id = $1`,
      [boardId],
    );
    if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
      throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
    const projectId = prjRes.rows[0].project_id;

    const methodPath = `/api/v1/boards/${boardId}/columns`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'manager',
      idempotencyKey,
      methodPath,
      body,
      boardId,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const column = await addColumn(client, boardId, body, actor.id);
    const responsePayload = { data: column };

    const saved = await saveReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      body,
      201,
      responsePayload,
    );

    await client.query('COMMIT');

    if (saved?.replayed) {
      return c.json(
        { ...(saved.responseBody as object), replayed: true },
        saved.statusCode as any,
      );
    }

    return c.json(responsePayload, 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 6. PATCH /api/v1/boards/:boardId/columns/:columnId: Update column
boardsRoutes.patch('/api/v1/boards/:boardId/columns/:columnId', authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param('boardId');
  const columnId = c.req.param('columnId');

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const rawBody = await c.req.json();
  const body = parseOrThrow(updateColumnInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const prjRes = await client.query<{ project_id: string }>(
      `SELECT project_id FROM boards WHERE id = $1`,
      [boardId],
    );
    if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
      throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
    const projectId = prjRes.rows[0].project_id;

    const methodPath = `/api/v1/boards/${boardId}/columns/${columnId}`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'manager',
      idempotencyKey,
      methodPath,
      body,
      boardId,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const updatedColumn = await updateColumn(client, boardId, columnId, body, actor.id);
    const responsePayload = { data: updatedColumn };

    const saved = await saveReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload,
    );

    await client.query('COMMIT');

    if (saved?.replayed) {
      return c.json(
        { ...(saved.responseBody as object), replayed: true },
        saved.statusCode as any,
      );
    }

    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 7. POST /api/v1/boards/:boardId/columns/reorder: Atomically reorder columns
boardsRoutes.post('/api/v1/boards/:boardId/columns/reorder', authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param('boardId');

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const rawBody = await c.req.json();
  const body = parseOrThrow(reorderColumnsInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const prjRes = await client.query<{ project_id: string }>(
      `SELECT project_id FROM boards WHERE id = $1`,
      [boardId],
    );
    if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
      throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
    const projectId = prjRes.rows[0].project_id;

    const methodPath = `/api/v1/boards/${boardId}/columns/reorder`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'manager',
      idempotencyKey,
      methodPath,
      body,
      boardId,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const result = await reorderColumns(client, boardId, body.columnIds, body.expectedBoardVersion, actor.id);
    const responsePayload = { data: result };

    const saved = await saveReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      body,
      200,
      responsePayload,
    );

    await client.query('COMMIT');

    if (saved?.replayed) {
      return c.json(
        { ...(saved.responseBody as object), replayed: true },
        saved.statusCode as any,
      );
    }

    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 8. DELETE /api/v1/boards/:boardId/columns/:columnId: Delete empty column
boardsRoutes.delete('/api/v1/boards/:boardId/columns/:columnId', authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param('boardId');
  const columnId = c.req.param('columnId');

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  // Parse expectedBoardVersion from query param or body
  let expectedBoardVersion: number | undefined;
  const qv = c.req.query('expectedBoardVersion');
  if (qv !== undefined) {
    const num = parseInt(qv, 10);
    if (!Number.isNaN(num) && num >= 0) {
      expectedBoardVersion = num;
    }
  }

  if (expectedBoardVersion === undefined) {
    try {
      const rawBody = await c.req.json();
      if (typeof rawBody?.expectedBoardVersion === 'number' && rawBody.expectedBoardVersion >= 0) {
        expectedBoardVersion = rawBody.expectedBoardVersion;
      }
    } catch {
      // Body empty or not JSON
    }
  }

  if (expectedBoardVersion === undefined) {
    throw HttpError.badRequest('Missing or invalid expectedBoardVersion parameter.', 'VALIDATION_ERROR');
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const prjRes = await client.query<{ project_id: string }>(
      `SELECT project_id FROM boards WHERE id = $1`,
      [boardId],
    );
    if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
      throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
    const projectId = prjRes.rows[0].project_id;

    const methodPath = `/api/v1/boards/${boardId}/columns/${columnId}`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'manager',
      idempotencyKey,
      methodPath,
      { expectedBoardVersion },
      boardId,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const result = await deleteColumn(client, boardId, columnId, expectedBoardVersion, actor.id);
    const responsePayload = { data: result };

    const saved = await saveReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      { expectedBoardVersion },
      200,
      responsePayload,
    );

    await client.query('COMMIT');

    if (saved?.replayed) {
      return c.json(
        { ...(saved.responseBody as object), replayed: true },
        saved.statusCode as any,
      );
    }

    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 9. GET /api/v1/boards/:boardId/columns/:columnId/placement: Placement neighbor calculation
boardsRoutes.get('/api/v1/boards/:boardId/columns/:columnId/placement', authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param('boardId');
  const columnId = c.req.param('columnId');

  const queryParams = c.req.query();
  const parsed = parseOrThrow(placementInputSchema, queryParams);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockBoardAccess(client, boardId, actor.id);
    const result = await getPlacement(
      client,
      boardId,
      columnId,
      parsed.movingCardId,
      parsed.at,
      parsed.anchorCardId,
      actor.id,
    );
    await client.query('COMMIT');
    return c.json({ data: result }, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

// 10. GET /api/v1/boards/:boardId/cards: Paginated cards in canonical position order
boardsRoutes.get('/api/v1/boards/:boardId/cards', authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param('boardId');

  const queryParams = c.req.query();
  const parsed = parseOrThrow(cardsQuerySchema, queryParams);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Keep the grant read lock through card delivery, serializing this read
    // with Owner revocation of the same board grant.
    await lockBoardAccess(client, boardId, actor.id);
    const result = await listBoardCards(client, boardId, parsed, actor.id);
    await client.query('COMMIT');
    return c.json(result, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

// 11. POST /api/v1/boards/:boardId/archive (BRD-08: Owner or Manager)
boardsRoutes.post('/api/v1/boards/:boardId/archive', authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param('boardId');
  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const access = await lockBoardAccess(client, boardId, actor.id);
    await acquireWriteGrantLock(client, access.projectId, actor.id, 'manager', boardId);

    // 1. Fetch board to get project_id
    const bCheck = await client.query<{ id: string; project_id: string; archived: boolean; snapshot_version: number; structure_version: number }>(
      `SELECT id, project_id, archived, snapshot_version, structure_version FROM boards WHERE id = $1 FOR UPDATE`,
      [boardId],
    );
    if (!bCheck.rows[0]) {
      throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
    const bRow = bCheck.rows[0];

    const methodPath = `/api/v1/boards/${boardId}/archive`;
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      'project',
      bRow.project_id,
      idempotencyKey,
      methodPath,
      {},
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const updateRes = await client.query<{
      id: string;
      workspace_id: string;
      project_id: string;
      name: string;
      archived: boolean;
      structure_version: number;
      snapshot_version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE boards
       SET archived = TRUE, structure_version = structure_version + 1, snapshot_version = snapshot_version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING id, workspace_id, project_id, name, archived, structure_version, snapshot_version, created_at, updated_at`,
      [boardId],
    );

    const updated = updateRes.rows[0]!;
    await recordActivity(client, {
      workspaceId: updated.workspace_id,
      projectId: updated.project_id,
      boardId,
      visibilityScope: 'board',
      actorId: actor.id,
      action: 'board_archived',
      safeChanges: { name: updated.name },
    });
    const board = {
      id: updated.id,
      projectId: updated.project_id,
      name: updated.name,
      isArchived: true,
      structureVersion: updated.structure_version,
      snapshotVersion: updated.snapshot_version,
      createdAt: new Date(updated.created_at).toISOString(),
      updatedAt: new Date(updated.updated_at).toISOString(),
    };

    const responsePayload = { data: board };
    const saved = await saveReceipt(
      client,
      actor.id,
      'project',
      bRow.project_id,
      idempotencyKey,
      methodPath,
      {},
      200,
      responsePayload,
    );

    await client.query('COMMIT');
    if (saved?.replayed) {
      return c.json(
        { ...(saved.responseBody as object), replayed: true },
        saved.statusCode as any,
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 12. POST /api/v1/boards/:boardId/reopen (BRD-08: Owner or Manager)
boardsRoutes.post('/api/v1/boards/:boardId/reopen', authMiddleware, async (c) => {
  const actor = getActorOrThrow(c);
  const boardId = c.req.param('boardId');
  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const access = await lockBoardAccess(client, boardId, actor.id);
    await acquireWriteGrantLock(client, access.projectId, actor.id, 'manager', boardId);

    // 1. Fetch board to get project_id
    const bCheck = await client.query<{ id: string; project_id: string; archived: boolean; snapshot_version: number; structure_version: number }>(
      `SELECT id, project_id, archived, snapshot_version, structure_version FROM boards WHERE id = $1 FOR UPDATE`,
      [boardId],
    );
    if (!bCheck.rows[0]) {
      throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
    const bRow = bCheck.rows[0];

    const methodPath = `/api/v1/boards/${boardId}/reopen`;
    const replay = await checkOrReplayReceipt(
      client,
      actor.id,
      'project',
      bRow.project_id,
      idempotencyKey,
      methodPath,
      {},
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const updateRes = await client.query<{
      id: string;
      workspace_id: string;
      project_id: string;
      name: string;
      archived: boolean;
      structure_version: number;
      snapshot_version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE boards
       SET archived = FALSE, structure_version = structure_version + 1, snapshot_version = snapshot_version + 1, updated_at = NOW()
       WHERE id = $1
       RETURNING id, workspace_id, project_id, name, archived, structure_version, snapshot_version, created_at, updated_at`,
      [boardId],
    );

    const updated = updateRes.rows[0]!;
    await recordActivity(client, {
      workspaceId: updated.workspace_id,
      projectId: updated.project_id,
      boardId,
      visibilityScope: 'board',
      actorId: actor.id,
      action: 'board_reopened',
      safeChanges: { name: updated.name },
    });
    const board = {
      id: updated.id,
      projectId: updated.project_id,
      name: updated.name,
      isArchived: false,
      structureVersion: updated.structure_version,
      snapshotVersion: updated.snapshot_version,
      createdAt: new Date(updated.created_at).toISOString(),
      updatedAt: new Date(updated.updated_at).toISOString(),
    };

    const responsePayload = { data: board };
    const saved = await saveReceipt(
      client,
      actor.id,
      'project',
      bRow.project_id,
      idempotencyKey,
      methodPath,
      {},
      200,
      responsePayload,
    );

    await client.query('COMMIT');
    if (saved?.replayed) {
      return c.json(
        { ...(saved.responseBody as object), replayed: true },
        saved.statusCode as any,
      );
    }
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});
