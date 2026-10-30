import { Hono } from 'hono';
import {
  idempotencyKeySchema,
  createImageUploadInputSchema,
  deleteImageInputSchema,
  parseOrThrow,
} from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { checkOrReplayProjectWriteReceipt, saveReceipt } from '../../adapters/idempotency.ts';
import {
  createImageUpload,
  receiveImageContent,
  finalizeImageUpload,
  getImageUpload,
  cancelImageUpload,
  listCardImages,
  getImageContent,
  deleteCardImage,
  deleteStorageAfterCommit,
} from '../../adapters/images.ts';
import { HttpError } from '../errors.ts';
import { getStorageDriver } from '../../adapters/storage.ts';
import { authMiddleware } from '../middleware/auth.ts';
import { acquireWriteGrantLock } from '../../adapters/rbac.ts';
import { lockBoardAccess } from '../../adapters/board-grants-foundation.ts';

export const imagesRoutes = new Hono();

// Fail closed before any database work: on a deployment with no private image bucket every image
// route answers 503 CONFIG_ERROR, so a staged row is never written for bytes that cannot be stored.
const requireImageStorage = async (_c: unknown, next: () => Promise<void>) => {
  getStorageDriver();
  await next();
};

// Storage may take time. Reauthorize after it returns, then keep the access
// locks until the response bytes have been assembled.
async function getImageForDelivery(imageId: string, actorId: string) {
  const pool = getPool();
  const result = await getImageContent(pool, actorId, imageId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const image = await client.query<{ board_id: string; card_id: string }>(
      `SELECT c.board_id, c.id AS card_id FROM card_images i
       JOIN cards c ON c.id = i.card_id AND c.project_id = i.project_id AND c.workspace_id = i.workspace_id
       WHERE i.id = $1`, [imageId],
    );
    if (!image.rows[0]) throw HttpError.notFound('Image not found.', 'NOT_FOUND');
    const access = await lockBoardAccess(client, image.rows[0].board_id, actorId);
    const card = await client.query<{ state: string }>(
      'SELECT state FROM cards WHERE id = $1 FOR SHARE', [image.rows[0].card_id],
    );
    if (card.rows[0]?.state !== 'active' &&
        !(card.rows[0]?.state === 'trashed' && (access.role === 'owner' || access.role === 'manager'))) {
      throw HttpError.notFound('Image not found.', 'NOT_FOUND');
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function requireIdempotencyKey(keyHeader: string | undefined): string {
  if (!keyHeader || !idempotencyKeySchema.safeParse(keyHeader).success) {
    throw HttpError.badRequest(
      'Missing or invalid Idempotency-Key header.',
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }
  return keyHeader;
}

// 1. POST /api/v1/cards/:cardId/image-uploads: Stage image upload (ATT-01)
imagesRoutes.post('/api/v1/cards/:cardId/image-uploads', authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const cardId = c.req.param('cardId');
  const idempotencyKey = requireIdempotencyKey(c.req.header('idempotency-key'));

  const rawBody = await c.req.json();
  const input = parseOrThrow(createImageUploadInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cardRes = await client.query<{ id: string; project_id: string; board_id: string; state: string }>(
      'SELECT id, project_id, board_id, state FROM cards WHERE id = $1',
      [cardId],
    );

    if (cardRes.rows.length === 0) {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }

    const card = cardRes.rows[0]!;
    const methodPath = `/api/v1/cards/${cardId}/image-uploads`;
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

    if (card.state !== 'active') {
      throw HttpError.conflict('Cannot attach images to a trashed or inactive card.', 'CARD_TRASHED');
    }

    const upload = await createImageUpload(client, actor.id, cardId, input);
    const responsePayload = { data: upload };

    await saveReceipt(
      client,
      actor.id,
      'project',
      card.project_id,
      idempotencyKey,
      methodPath,
      rawBody,
      201,
      responsePayload,
    );

    await client.query('COMMIT');
    return c.json(responsePayload, 201);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 2. PUT /api/v1/image-uploads/:uploadId/content: Upload raw binary bytes (ATT-01, ATT-02)
imagesRoutes.put('/api/v1/image-uploads/:uploadId/content', authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const uploadId = c.req.param('uploadId');
  const arrayBuffer = await c.req.arrayBuffer();
  const rawBytes = new Uint8Array(arrayBuffer);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scope = await client.query<{ project_id: string; board_id: string }>(
      `SELECT u.project_id, c.board_id FROM card_image_uploads u
       JOIN cards c ON c.id = u.card_id WHERE u.id = $1`, [uploadId],
    );
    if (!scope.rows[0]) throw HttpError.notFound('Upload staging record not found.', 'NOT_FOUND');
    await acquireWriteGrantLock(client, scope.rows[0].project_id, actor.id, 'member', scope.rows[0].board_id);
    const upload = await receiveImageContent(client, actor.id, uploadId, rawBytes);
    await client.query('COMMIT');
    return c.json({ data: upload }, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

// 3. POST /api/v1/image-uploads/:uploadId/finalize: Finalize attachment to card (ATT-02)
imagesRoutes.post('/api/v1/image-uploads/:uploadId/finalize', authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const uploadId = c.req.param('uploadId');
  const idempotencyKey = requireIdempotencyKey(c.req.header('idempotency-key'));

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const uploadRes = await client.query<{
      id: string;
      project_id: string;
      card_id: string;
      board_id: string;
      state: string;
      finalized_image_id: string | null;
    }>(`SELECT u.id, u.project_id, u.card_id, c.board_id, u.state, u.finalized_image_id
        FROM card_image_uploads u JOIN cards c ON c.id = u.card_id WHERE u.id = $1`, [
      uploadId,
    ]);

    if (uploadRes.rows.length === 0) {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Upload staging record not found.', 'NOT_FOUND');
    }

    const uploadRecord = uploadRes.rows[0]!;
    const methodPath = `/api/v1/image-uploads/${uploadId}/finalize`;

    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      uploadRecord.project_id,
      'member',
      idempotencyKey,
      methodPath,
      {},
      uploadRecord.board_id,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const finalized = await finalizeImageUpload(client, actor.id, uploadId);
    const responsePayload = { data: finalized };
    await saveReceipt(client, actor.id, 'project', uploadRecord.project_id,
      idempotencyKey, methodPath, {}, 200, responsePayload);
    await client.query('COMMIT');

    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});

// 4. GET /api/v1/image-uploads/:uploadId: Progress & status inspect (ATT-01)
imagesRoutes.get('/api/v1/image-uploads/:uploadId', authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const uploadId = c.req.param('uploadId');
  const pool = getPool();
  const upload = await getImageUpload(pool, actor.id, uploadId);

  return c.json({ data: upload }, 200);
});

// 5. DELETE /api/v1/image-uploads/:uploadId: Cancel pending upload (ATT-01)
imagesRoutes.delete('/api/v1/image-uploads/:uploadId', authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const uploadId = c.req.param('uploadId');
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scope = await client.query<{ project_id: string; board_id: string }>(
      `SELECT u.project_id, c.board_id FROM card_image_uploads u
       JOIN cards c ON c.id = u.card_id WHERE u.id = $1`, [uploadId],
    );
    if (!scope.rows[0]) throw HttpError.notFound('Upload staging record not found.', 'NOT_FOUND');
    await acquireWriteGrantLock(client, scope.rows[0].project_id, actor.id, 'member', scope.rows[0].board_id);
    const upload = await cancelImageUpload(client, actor.id, uploadId);
    await client.query('COMMIT');
    return c.json({ data: upload }, 200);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

// 6. GET /api/v1/cards/:cardId/images: List finalized images (ATT-03)
imagesRoutes.get('/api/v1/cards/:cardId/images', authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const cardId = c.req.param('cardId');
  const pool = getPool();
  const client = await pool.connect();
  let result: Awaited<ReturnType<typeof listCardImages>>;
  try {
    await client.query('BEGIN');
    const card = await client.query<{ board_id: string }>('SELECT board_id FROM cards WHERE id = $1', [cardId]);
    if (!card.rows[0]) throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    await lockBoardAccess(client, card.rows[0].board_id, actor.id);
    result = await listCardImages(client, actor.id, cardId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  return c.json(
    {
      data: {
        items: result.items,
        nextCursor: null,
        totalCount: result.totalCount,
      },
    },
    200,
  );
});

// 7. GET /api/v1/images/:imageId/content: Authenticated proxy content download (ATT-04)
imagesRoutes.get('/api/v1/images/:imageId/content', authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const imageId = c.req.param('imageId');
  const result = await getImageForDelivery(imageId, actor.id);

  return new Response(Buffer.from(result.data), {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(result.filename)}"`,
      'Content-Length': String(result.byteLength),
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// 8. GET /api/v1/images/:imageId/thumbnail: Authenticated proxy thumbnail (ATT-04)
imagesRoutes.get('/api/v1/images/:imageId/thumbnail', authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const imageId = c.req.param('imageId');
  const result = await getImageForDelivery(imageId, actor.id);

  return new Response(Buffer.from(result.data), {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `inline; filename="${encodeURIComponent(result.filename)}"`,
      'Content-Length': String(result.byteLength),
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// 9. DELETE /api/v1/images/:imageId: Remove attached image (ATT-05)
imagesRoutes.delete('/api/v1/images/:imageId', authMiddleware, requireImageStorage, async (c) => {
  const actor = c.get('actor');
  if (!actor) {
    throw HttpError.unauthorized('Invalid or missing authentication session.');
  }

  const imageId = c.req.param('imageId');
  const idempotencyKey = requireIdempotencyKey(c.req.header('idempotency-key'));

  const rawBody = await c.req.json();
  const input = parseOrThrow(deleteImageInputSchema, rawBody);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const imgRes = await client.query<{ id: string; project_id: string; board_id: string }>(
      'SELECT i.id, i.project_id, c.board_id FROM card_images i JOIN cards c ON c.id = i.card_id WHERE i.id = $1',
      [imageId],
    );

    if (imgRes.rows.length === 0) {
      await client.query('ROLLBACK');
      throw HttpError.notFound('Image not found.', 'NOT_FOUND');
    }

    const projectId = imgRes.rows[0]!.project_id;
    const methodPath = `/api/v1/images/${imageId}`;

    const replay = await checkOrReplayProjectWriteReceipt(
      client,
      actor.id,
      projectId,
      'member',
      idempotencyKey,
      methodPath,
      rawBody,
      imgRes.rows[0]!.board_id,
    );

    if (replay) {
      await client.query('ROLLBACK');
      return c.json(
        { ...(replay.responseBody as object), replayed: true },
        replay.statusCode as any,
      );
    }

    const { result, storageKey } = await deleteCardImage(client, actor.id, imageId, input.expectedVersion);
    const responsePayload = { data: result };
    await saveReceipt(client, actor.id, 'project', projectId,
      idempotencyKey, methodPath, rawBody, 200, responsePayload);
    await client.query('COMMIT');
    // Bytes go only after the commit (B-8). A failed storage delete is retried by the purge job.
    await deleteStorageAfterCommit(client, storageKey);

    return c.json(responsePayload, 200);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
});
