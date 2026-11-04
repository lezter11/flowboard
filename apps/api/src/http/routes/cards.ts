import { Hono } from 'hono';
import {
  createCardInputSchema,
  updateCardInputSchema,
  moveCardInputSchema,
  moveUndoInputSchema,
  cardsQuerySchema,
  myTasksQuerySchema,
  idempotencyKeySchema,
  parseOrThrow,
} from '@flowboard/contracts';
import { acquireWriteGrantLock } from '../../adapters/rbac.ts';
import { lockSelectedAssignees } from '../../services/assignee-locks.ts';
import { getPool } from '../../adapters/postgres.ts';
import { lockProjectBoardReadScope } from '../../adapters/board-grants-foundation.ts';
import { checkOrReplayProjectWriteReceipt, saveReceipt, sha256 } from '../../adapters/idempotency.ts';
import { lockPersonalAccessToken } from '../../adapters/tokens.ts';
import { lockHostedOAuthCredential } from '../../adapters/hosted-oauth.ts';
import {
  createCard,
  getCard,
  updateCard,
  moveCard,
  searchProjectCards,
  getMyTasks,
} from '../../adapters/cards.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware, requireTokenScope } from '../middleware/auth.ts';

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
cardsRoutes.post('/api/v1/boards/:boardId/cards', authMiddleware, requireTokenScope('cards:create'), async (c) => {
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

  const tokenProjectId = c.get('tokenProjectId');
  if (tokenProjectId && tokenProjectId !== projectId) {
    throw HttpError.forbidden('Token is restricted to a different project.');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tokenId = c.get('tokenId');
    const oauth = c.get('machineCredentialKind') === 'mcp_oauth';
    if (oauth) {
      const accessTokenId = c.get('oauthAccessTokenId');
      const resource = c.get('oauthResource');
      if (!tokenId || !accessTokenId || !resource) throw HttpError.unauthorized('Invalid MCP credential.');
      await lockHostedOAuthCredential(client, {
        connectionId: tokenId, accessTokenId, userId: actor.id, projectId,
        requiredScope: 'cards:create', resource,
      });
    } else if (tokenId) {
      // Keep this credential's authorization stable until the card, activity and
      // receipt commit. Revocation must take the conflicting row lock.
      await lockPersonalAccessToken(client, {
        tokenId, userId: actor.id, projectId, requiredScope: 'cards:create',
      });
    }

    // A machine operation survives client/process retries. Its receipt is bound
    // to the credential, and excludes only the transient optimistic revision.
    // The caller's raw key is never persisted for token-authenticated writes.
    const receiptKey = tokenId
      ? `${oauth ? 'oauth' : 'pat'}:${sha256(JSON.stringify([tokenId, idempotencyKey]))}`
      : idempotencyKey;
    const { expectedBoardVersion: _revision, ...semanticInput } = input;
    const receiptBody = tokenId
      ? { ...semanticInput, assigneeIds: [...semanticInput.assigneeIds].sort() }
      : rawBody;

    await acquireWriteGrantLock(client, projectId, actor.id, 'member', boardId);
    const lockedAssignees = await lockSelectedAssignees(client, projectId, boardId, input.assigneeIds);
    const methodPath = `/api/v1/boards/${boardId}/cards`;
    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'member',
      receiptKey,
      methodPath,
      receiptBody,
      boardId,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const card = await createCard(client, boardId, input, actor.id, tokenId ? {
      type: oauth ? 'mcp_oauth' : 'personal_access_token',
      credentialId: tokenId,
      operationIdHash: sha256(idempotencyKey),
    } : { type: 'session' }, lockedAssignees);
    const responseBody = { data: card };

    await saveReceipt(
      client,
      actor.id,
      'project',
      projectId,
      receiptKey,
      methodPath,
      receiptBody,
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

    // 1. Read card state (plain SELECT, not a lock; the adapter rechecks state under its locks) (F-05)
    const cardLookup = await client.query<{ id: string; project_id: string; board_id: string; state: string }>(
      'SELECT id, project_id, board_id, state FROM cards WHERE id = $1',
      [cardId],
    );

    if (cardLookup.rows.length === 0 || cardLookup.rows[0]!.state !== 'active') {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }
    const { project_id: projectId, board_id: boardId } = cardLookup.rows[0]!;

    await acquireWriteGrantLock(client, projectId, actor.id, 'member', boardId);
    const lockedAssignees = input.assigneeIds === undefined ? undefined :
      await lockSelectedAssignees(client, projectId, boardId, input.assigneeIds);
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

    const updated = await updateCard(client, cardId, input, actor.id, lockedAssignees);
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

    // 1. Read card state (plain SELECT, not a lock; the adapter rechecks state under its locks) (F-05)
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
    moveUndoInputSchema,
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
    const actRes = await client.query<{ id:string; safe_changes: any }>(
      `SELECT id,safe_changes
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
    const fact=actRes.rows[0];
    if(fact.safe_changes.undoOfActivityId || !Object.hasOwn(fact.safe_changes,'fromPreviousCardId') ||
      !Object.hasOwn(fact.safe_changes,'fromNextCardId')){
      throw HttpError.conflict('NO_PREVIOUS_MOVE','This move was already undone or lacks a safe original position.');
    }

    // Verify destination column still exists and is on the same board
    const colRes = await client.query<{ id: string }>(
      `SELECT id FROM columns WHERE id = $1 AND board_id = $2 AND deleted_at IS NULL`,
      [fromColumnId, card.board_id],
    );
    if (colRes.rows.length === 0) {
      await client.query('ROLLBACK');
      throw HttpError.conflict('DESTINATION_COLUMN_MISSING', 'Previous column no longer exists.');
    }

    // Perform the move back using moveCard logic
    let moved;
    try { moved = await moveCard(
      client,
      cardId,
      {
        toColumnId: fromColumnId,
        previousCardId: fact.safe_changes.fromPreviousCardId,
        nextCardId: fact.safe_changes.fromNextCardId,
        expectedVersion: input.expectedVersion,
        expectedBoardVersion: input.expectedBoardVersion,
      },
      actor.id,
      {undoOfActivityId:fact.id},
    ); } catch(error) {
      if(error instanceof HttpError && error.status===422)throw HttpError.conflict('STALE_BOARD_VERSION','The original card position changed. Refresh and move the card manually.');
      throw error;
    }

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

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const boardIds = await lockProjectBoardReadScope(client, projectId, actor.id);
    const parsed = parseOrThrow(cardsQuerySchema, query);
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

  const query = parseOrThrow(myTasksQuerySchema, c.req.query());
  const { projectId } = query;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const boardIds = await lockProjectBoardReadScope(client, projectId, actor.id);
    const result = await getMyTasks(client, actor.id, { ...query, authorizedBoardIds: boardIds });
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
  const query = parseOrThrow(myTasksQuerySchema.omit({ workspaceId: true }), c.req.query());
  const { projectId } = query;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const boardIds = await lockProjectBoardReadScope(client, projectId, actor.id);
    const result = await getMyTasks(client, actor.id, { ...query, workspaceId, authorizedBoardIds: boardIds });
    await client.query('COMMIT');
    return c.json(result, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});
