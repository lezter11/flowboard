import { Hono } from 'hono';
import { z } from 'zod';
import {
  createCardInputSchema,
  updateCardInputSchema,
  moveCardInputSchema,
  cardsQuerySchema,
  idempotencyKeySchema,
  parseOrThrow,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { lockProjectBoardReadScope } from '../../adapters/board-grants-foundation.ts';
import { checkOrReplayProjectWriteReceipt, saveReceipt } from '../../adapters/idempotency.ts';
import {
  createCard,
  getCard,
  updateCard,
  moveCard,
  searchProjectCards,
  getMyTasks,
} from '../../adapters/cards.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';

export const cardsRoutes = new Hono();

function requireIdempotencyKey(keyHeader: string | undefined): string {
  if (!keyHeader || !idempotencyKeySchema.safeParse(keyHeader).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }
  return keyHeader;
}

// 1. POST /api/v1/boards/:boardId/cards: Quick card creation (CRD-01, CRD-11)
cardsRoutes.post('/api/v1/boards/:boardId/cards', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const boardId = c.req.param('boardId');
  const idempotencyKey = requireIdempotencyKey(c.req.header('idempotency-key'));

  const rawBody = await c.req.json();
  const input = parseOrThrow(createCardInputSchema, rawBody);

  const pool = getPool();

  // Find board to resolve projectId for receipt scope
  const boardRes = await pool.query<{ id: string; project_id: string; archived: boolean }>(
    'SELECT id, project_id, archived FROM boards WHERE id = $1',
    [boardId],
  );
  if (boardRes.rows.length === 0) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }
  const projectId = boardRes.rows[0]!.project_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const methodPath = `/api/v1/boards/${boardId}/cards`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'member',
      idempotencyKey,
      methodPath,
      rawBody,
      boardId,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const card = await createCard(client, boardId, input, actor.id);
    const responseBody = { data: card };

    await saveReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      rawBody,
      201,
      responseBody,
    );

    await client.query('COMMIT');
    return c.json(responseBody, 201);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

// 2. GET /api/v1/cards/:cardId: Full card entity + referenced PersonDisplay records (CRD-03)
cardsRoutes.get('/api/v1/cards/:cardId', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const cardId = c.req.param('cardId');
  const pool = getPool();
  const result = await getCard(pool, cardId, actor.id);

  return c.json(
    {
      data: {
        ...result.card,
        people: result.people,
      },
      people: result.people,
    },
    200,
  );
});

// 3. PATCH /api/v1/cards/:cardId: Update title, description, priority, due date, assignees (CRD-04, CRD-05, CRD-06, CRD-10, CRD-11)
cardsRoutes.patch('/api/v1/cards/:cardId', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const cardId = c.req.param('cardId');
  const idempotencyKey = requireIdempotencyKey(c.req.header('idempotency-key'));

  const rawBody = await c.req.json();
  const input = parseOrThrow(updateCardInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock card row FOR SHARE to serialize against concurrent trash/delete (F-05)
    const cardLookup = await client.query<{ id: string; project_id: string; board_id: string; state: string }>(
      'SELECT id, project_id, board_id, state FROM cards WHERE id = $1',
      [cardId],
    );

    if (cardLookup.rows.length === 0 || cardLookup.rows[0]!.state !== 'active') {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }
    const { project_id: projectId, board_id: boardId } = cardLookup.rows[0]!;

    const methodPath = `/api/v1/cards/${cardId}`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'member',
      idempotencyKey,
      methodPath,
      rawBody,
      boardId,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const updated = await updateCard(client, cardId, input, actor.id);
    const responseBody = { data: updated };

    await saveReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      rawBody,
      200,
      responseBody,
    );

    await client.query('COMMIT');
    return c.json(responseBody, 200);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

// 4. POST /api/v1/cards/:cardId/move: Move card within or across columns (CRD-07, CRD-10, CRD-11)
cardsRoutes.post('/api/v1/cards/:cardId/move', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const cardId = c.req.param('cardId');
  const idempotencyKey = requireIdempotencyKey(c.req.header('idempotency-key'));

  const rawBody = await c.req.json();
  const input = parseOrThrow(moveCardInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock card row FOR SHARE to serialize against concurrent trash/delete (F-05)
    const cardLookup = await client.query<{ id: string; project_id: string; board_id: string; state: string }>(
      'SELECT id, project_id, board_id, state FROM cards WHERE id = $1',
      [cardId],
    );

    if (cardLookup.rows.length === 0 || cardLookup.rows[0]!.state !== 'active') {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }
    const { project_id: projectId, board_id: boardId } = cardLookup.rows[0]!;

    const methodPath = `/api/v1/cards/${cardId}/move`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'member',
      idempotencyKey,
      methodPath,
      rawBody,
      boardId,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const moved = await moveCard(client, cardId, input, actor.id);
    const responseBody = { data: moved };

    await saveReceipt(
      client,
      actor.id,
      'project',
      projectId,
      idempotencyKey,
      methodPath,
      rawBody,
      200,
      responseBody,
    );

    await client.query('COMMIT');
    return c.json(responseBody, 200);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

// 4b. POST /api/v1/cards/:cardId/move-undo: Revert last move (CRD-12)
cardsRoutes.post('/api/v1/cards/:cardId/move-undo', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const cardId = c.req.param('cardId');
  const idempotencyKey = requireIdempotencyKey(c.req.header('idempotency-key'));

  const rawBody = await c.req.json();
  const input = parseOrThrow(
    z.object({
      expectedVersion: z.number().int().nonnegative(),
      expectedBoardVersion: z.number().int().nonnegative(),
    }),
    rawBody,
  );

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock card row
    const cardLookup = await client.query<{ id: string; project_id: string; board_id: string; state: string; version: number }>(
      'SELECT id, project_id, board_id, state, version FROM cards WHERE id = $1',
      [cardId],
    );

    if (cardLookup.rows.length === 0 || cardLookup.rows[0]!.state !== 'active') {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }
    const card = cardLookup.rows[0]!;

    const methodPath = `/api/v1/cards/${cardId}/move-undo`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      card.project_id,
      'member',
      idempotencyKey,
      methodPath,
      rawBody,
      card.board_id,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    // OCC Check: If intervening work occurred, fail with 409 STALE_VERSION
    if (card.version !== input.expectedVersion) {
      await client.query('ROLLBACK');
      throw HttpError.conflict('STALE_VERSION', 'Cannot undo move: card has been modified by intervening work.');
    }

    // 2. Find last card_moved activity fact
    const actRes = await client.query<{ safe_changes: any }>(
      `SELECT safe_changes
       FROM activity_log
       WHERE card_id = $1 AND action = 'card_moved'
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [cardId],
    );

    if (actRes.rows.length === 0 || !actRes.rows[0]?.safe_changes?.fromColumnId) {
      await client.query('ROLLBACK');
      throw HttpError.conflict('NO_PREVIOUS_MOVE', 'Cannot undo: no prior move recorded for this card.');
    }

    const { fromColumnId } = actRes.rows[0].safe_changes;

    // Verify destination column still exists and is on the same board
    const colRes = await client.query<{ id: string }>(
      `SELECT id FROM columns WHERE id = $1 AND board_id = $2`,
      [fromColumnId, card.board_id],
    );
    if (colRes.rows.length === 0) {
      await client.query('ROLLBACK');
      throw HttpError.conflict('DESTINATION_COLUMN_MISSING', 'Previous column no longer exists.');
    }

    // Perform the move back using moveCard logic
    const moved = await moveCard(
      client,
      cardId,
      {
        toColumnId: fromColumnId,
        previousCardId: null,
        nextCardId: null,
        expectedVersion: input.expectedVersion,
        expectedBoardVersion: input.expectedBoardVersion,
      },
      actor.id,
    );

    const responsePayload = { data: moved };
    const saved = await saveReceipt(
      client,
      actor.id,
      'project',
      card.project_id,
      idempotencyKey,
      methodPath,
      rawBody,
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

// 5. GET /api/v1/projects/:projectId/cards/search: Search active cards across a project (project-scoped)
cardsRoutes.get('/api/v1/projects/:projectId/cards/search', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const query = c.req.query();
  const parsed = parseOrThrow(cardsQuerySchema, query);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const boardIds = await lockProjectBoardReadScope(client, projectId, actor.id);
    const result = await searchProjectCards(client, projectId, parsed, actor.id, boardIds);
    await client.query('COMMIT');
    return c.json(result, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

// 8. GET /api/v1/me/tasks?projectId=: Retrieve actor's active assignments in one project (QRY-03)
cardsRoutes.get('/api/v1/me/tasks', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const limitParam = c.req.query('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  const workspaceId = c.req.query('workspaceId');
  const projectId = c.req.query('projectId')?.trim();
  if (!projectId) throw HttpError.badRequest('projectId is required for My Tasks.');

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const boardIds = await lockProjectBoardReadScope(client, projectId, actor.id);
    const result = await getMyTasks(client, actor.id, { limit, workspaceId, projectId, authorizedBoardIds: boardIds });
    await client.query('COMMIT');
    return c.json(result, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

// 9. GET /api/v1/workspaces/:workspaceId/my-tasks?projectId=: Retrieve actor's active assignments within one project (QRY-03)
cardsRoutes.get('/api/v1/workspaces/:workspaceId/my-tasks', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const workspaceId = c.req.param('workspaceId');
  const limitParam = c.req.query('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  const projectId = c.req.query('projectId')?.trim();
  if (!projectId) throw HttpError.badRequest('projectId is required for My Tasks.');

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const boardIds = await lockProjectBoardReadScope(client, projectId, actor.id);
    const result = await getMyTasks(client, actor.id, { limit, workspaceId, projectId, authorizedBoardIds: boardIds });
    await client.query('COMMIT');
    return c.json(result, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});
