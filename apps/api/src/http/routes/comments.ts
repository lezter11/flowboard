import { Hono } from 'hono';
import {
  idempotencyKeySchema,
  postCommentInputSchema,
  editCommentInputSchema,
  deleteCommentInputSchema,
  parseOrThrow,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { lockBoardAccess } from '../../adapters/board-grants-foundation.ts';
import { checkOrReplayProjectWriteReceipt, saveReceipt } from '../../adapters/idempotency.ts';
import {
  listCardComments,
  postComment,
  editComment,
  deleteComment,
} from '../../adapters/comments.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';
import { acquireWriteGrantLock, acquireWritableProjectContextLock } from '../../adapters/rbac.ts';

export const commentsRoutes = new Hono();

function parseLimit(limitParam?: string): number {
  if (!limitParam) return 50;
  const parsed = parseInt(limitParam, 10);
  if (Number.isNaN(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 100);
}

// 1. GET /cards/:cardId/comments: List comments for card readers
commentsRoutes.get('/cards/:cardId/comments', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const cardId = c.req.param('cardId');
  const queryParams = c.req.query();
  const limit = parseLimit(queryParams.limit);
  const cursor = queryParams.cursor;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cardContext = await client.query<{ board_id: string }>(
      'SELECT board_id FROM cards WHERE id = $1', [cardId],
    );
    if (!cardContext.rows[0]) throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    await lockBoardAccess(client, cardContext.rows[0].board_id, actor.id);
    const result = await listCardComments(client, cardId, actor.id, {
      limit,
      cursor: cursor !== undefined ? cursor : undefined,
    });
    await client.query('COMMIT');
    return c.json(result, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

// 2. POST /cards/:cardId/comments: Post comment (Idempotent)
commentsRoutes.post('/cards/:cardId/comments', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const cardId = c.req.param('cardId');

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const rawBody = await c.req.json();
  const body = parseOrThrow(postCommentInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock order: grant/membership, then project and board, then card row. Move and other board
    // writes take the board before the card; a card-row lock taken first deadlocked against them
    // (review R2-01). The card is read unlocked only to learn its scope.
    const cardRes = await client.query<{ project_id: string; board_id: string }>(
      `SELECT project_id, board_id FROM cards WHERE id = $1`,
      [cardId],
    );

    if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }

    const projectId = cardRes.rows[0].project_id;
    const boardId = cardRes.rows[0].board_id;
    const methodPath = `/api/v1/cards/${cardId}/comments`;
    await acquireWriteGrantLock(client, projectId, actor.id, 'member', boardId);
    await acquireWritableProjectContextLock(client, projectId, boardId);
    const cardRow = await client.query<{ state: string }>(
      `SELECT state FROM cards WHERE id = $1 FOR SHARE`,
      [cardId],
    );
    if (cardRow.rows[0]?.state === 'trashed') {
      throw HttpError.badRequest('CARD_IS_TRASHED', 'Cannot comment on a trashed card.');
    }
    if (cardRow.rows[0]?.state !== 'active') {
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }

    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'member',
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

    const comment = await postComment(client, cardId, body, actor.id);

    const responsePayload = { data: comment };
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
    return c.json({ ...responsePayload, replayed: false }, 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 3. PATCH /comments/:commentId: Edit comment (Author only, Idempotent)
commentsRoutes.patch('/comments/:commentId', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const commentId = c.req.param('commentId');

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  const rawBody = await c.req.json();
  const body = parseOrThrow(editCommentInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cmtRes = await client.query<{ project_id: string; board_id: string; card_state: string }>(
      `SELECT c.project_id, cd.board_id, cd.state AS card_state
       FROM comments c JOIN cards cd ON cd.id = c.card_id
       WHERE c.id = $1
       FOR SHARE OF cd`,
      [commentId],
    );

    if (cmtRes.rows.length === 0 || !cmtRes.rows[0]) {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Comment not found.', 'NOT_FOUND');
    }

    const projectId = cmtRes.rows[0].project_id;
    if (cmtRes.rows[0].card_state === 'trashed') {
      throw HttpError.badRequest('CARD_IS_TRASHED', 'Cannot edit comments on a trashed card.');
    }
    if (cmtRes.rows[0].card_state === 'purged') {
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }
    const methodPath = `/api/v1/comments/${commentId}`;

    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'member',
      idempotencyKey,
      methodPath,
      body,
      cmtRes.rows[0].board_id,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const comment = await editComment(client, commentId, body, actor.id);

    const responsePayload = { data: comment };
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
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 4. DELETE /comments/:commentId: Delete comment (Author or Moderator, Idempotent)
commentsRoutes.delete('/comments/:commentId', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const commentId = c.req.param('commentId');

  const idempotencyKey = c.req.header('idempotency-key');
  if (!idempotencyKey || !idempotencyKeySchema.safeParse(idempotencyKey).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    const vParam = c.req.query('expectedVersion');
    if (vParam) {
      rawBody = { expectedVersion: parseInt(vParam, 10) };
    }
  }

  const body = parseOrThrow(deleteCommentInputSchema, rawBody ?? {});

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cmtRes = await client.query<{
      project_id: string;
      board_id: string;
      author_id: string;
      card_state: string;
    }>(
      `SELECT c.project_id, c.author_id, cd.board_id, cd.state AS card_state
       FROM comments c JOIN cards cd ON cd.id = c.card_id
       WHERE c.id = $1
       FOR SHARE OF cd`,
      [commentId],
    );

    if (cmtRes.rows.length === 0 || !cmtRes.rows[0]) {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Comment not found.', 'NOT_FOUND');
    }

    const projectId = cmtRes.rows[0].project_id;
    if (cmtRes.rows[0].card_state === 'trashed') {
      throw HttpError.badRequest('CARD_IS_TRASHED', 'Cannot delete comments on a trashed card.');
    }
    if (cmtRes.rows[0].card_state === 'purged') {
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }
    const methodPath = `/api/v1/comments/${commentId}`;

    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      actor.id === cmtRes.rows[0].author_id ? 'member' : 'manager',
      idempotencyKey,
      methodPath,
      body,
      cmtRes.rows[0].board_id,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const result = await deleteComment(client, commentId, body.expectedVersion, actor.id);

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
    return c.json({ ...responsePayload, replayed: false }, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});
