import { Hono } from 'hono';
import { z } from 'zod';
import {
  idempotencyKeySchema,
  softDeleteCardInputSchema,
  restoreCardInputSchema,
  parseOrThrow,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { acquireWriteGrantLock } from '../../adapters/rbac.ts';
import { checkOrReplayProjectWriteReceipt, saveReceipt } from '../../adapters/idempotency.ts';
import {
  deleteCard,
  listProjectTrash,
  restoreCard,
  getCardById,
} from '../../adapters/trash.ts';
import { HttpError } from '../errors.ts';
import { authMiddleware } from '../middleware/auth.ts';

export const trashRoutes = new Hono();

// 1. POST /cards/:cardId/delete: Soft delete card (DEL-01, Idempotent)
trashRoutes.post('/cards/:cardId/delete', authMiddleware, async (c) => {
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
  const body = parseOrThrow(softDeleteCardInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cardRes = await client.query<{ project_id: string; board_id: string }>(
      `SELECT project_id, board_id FROM cards WHERE id = $1`,
      [cardId],
    );

    if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }

    const projectId = cardRes.rows[0].project_id;
    const methodPath = `/api/v1/cards/${cardId}/delete`;

    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'manager',
      idempotencyKey,
      methodPath,
      body,
      cardRes.rows[0].board_id,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const card = await deleteCard(client, cardId, body, actor.id);

    const responsePayload = { data: card };
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

const trashQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

// 3. GET /projects/:projectId/trash: List project trash for admins (DEL-02)
trashRoutes.get('/projects/:projectId/trash', authMiddleware, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const projectId = c.req.param('projectId');
  const queryParams = c.req.query();
  const parsed = trashQuerySchema.safeParse(queryParams);
  const options = parsed.success ? parsed.data : undefined;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const access = await acquireWriteGrantLock(client, projectId, actor.id, 'manager');
    // Lock the exact grants that may contribute titles to this page. Grant
    // revocation waits until delivery, and later additions cannot enter it.
    const grants = access.isOwner ? [] : (await client.query<{ board_id: string }>(
      `SELECT board_id FROM board_grants
       WHERE project_id = $1 AND user_id = $2
       ORDER BY board_id FOR SHARE`,
      [projectId, actor.id],
    )).rows.map((row) => row.board_id);
    const result = await listProjectTrash(client, projectId, actor.id, {
      ...options,
      ...(!access.isOwner ? { authorizedBoardIds: grants } : {}),
    });
    await client.query('COMMIT');
    return c.json(result, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 4. POST /cards/:cardId/restore: Restore trashed card (DEL-03, DEL-04, DEL-05, Idempotent)
trashRoutes.post('/cards/:cardId/restore', authMiddleware, async (c) => {
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
  const body = parseOrThrow(restoreCardInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cardRes = await client.query<{ project_id: string; board_id: string }>(
      `SELECT project_id, board_id FROM cards WHERE id = $1`,
      [cardId],
    );

    if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }

    const projectId = cardRes.rows[0].project_id;
    const methodPath = `/api/v1/cards/${cardId}/restore`;

    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'manager',
      idempotencyKey,
      methodPath,
      body,
      cardRes.rows[0].board_id,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const card = await restoreCard(client, cardId, body, actor.id);

    const responsePayload = { data: card };
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
