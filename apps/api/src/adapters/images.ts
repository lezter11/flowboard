import { validateJpegEntropy } from '../services/jpeg-entropy.ts';
import { validatePngPixelStream } from '../services/png-stream.ts';
import { assertImageWorkActive, retainImageWork } from '../services/image-admission.ts';
import crypto from 'node:crypto';
import pg from 'pg';
import type {
  CreateImageUploadInput,
  ImageUpload,
  FinalizedImage,
} from '@flowboard/contracts';
import { HttpError } from '../http/errors.ts';
import { verifyImagePixels, imageVerificationUnavailable, IMAGE_VERIFICATION_DEADLINE_MS } from '../services/image-verifier.ts';
import { getStorageDriver } from './storage.ts';
import {
  validateImageBinary,
  ImageValidationError,
} from '../services/image-validator.ts';
import {
  verifyProjectAncestry,
  resolveProjectRole,
  acquireWriteGrantLock,
} from './rbac.ts';
import { recordActivity } from './activity.ts';

export const MAX_CARD_IMAGES = 10;

/**
 * The storage key of an upload's staged bytes (B-14, FB-AUD-09). New uploads store a random key
 * with no user filename in it. A row with no stored key (written by an instance that ran before
 * migration 0017) keeps the key its bytes were written under, so cleanup can still delete them.
 */
export function stagingKeyOf(upload: { id: string; filename: string; staging_storage_key: string | null }): string {
  return upload.staging_storage_key ?? `staging/${upload.id}/${upload.filename}`;
}

async function requireImageBoardAccess(
  db: pg.ClientBase | pg.Pool, cardId: string, actorId: string,
): Promise<{ boardId: string; projectId: string; role: string }> {
  const result = await db.query<{ board_id: string; project_id: string; role: string }>(
    `SELECT c.board_id, c.project_id,
       CASE WHEN w.owner_id = $2 THEN 'owner' ELSE pm.role END AS role
     FROM cards c JOIN projects p ON p.id = c.project_id
     JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
     LEFT JOIN board_grants bg ON bg.board_id = c.board_id AND bg.project_id = p.id AND bg.user_id = $2
     WHERE c.id = $1 AND (w.owner_id = $2 OR (pm.id IS NOT NULL AND bg.board_id IS NOT NULL))`,
    [cardId, actorId],
  );
  const row = result.rows[0];
  if (!row) throw HttpError.notFound('Image not found.', 'NOT_FOUND');
  return { boardId: row.board_id, projectId: row.project_id, role: row.role };
}

interface CardImageUploadRow {
  id: string;
  workspace_id: string;
  project_id: string;
  card_id: string;
  uploader_id: string;
  filename: string;
  byte_length: number;
  content_type: string;
  sha256: string;
  staging_storage_key: string | null;
  state: string;
  expires_at: Date;
  finalized_image_id: string | null;
  version: number;
  received_bytes: number | null;
  error: { code: string; message: string; retryable: boolean } | null;
  created_at: Date;
  updated_at: Date;
}

interface CardImageRow {
  id: string;
  workspace_id: string;
  project_id: string;
  card_id: string;
  uploader_id: string;
  filename: string;
  byte_length: number;
  content_type: string;
  storage_key: string;
  sha256: string;
  width: number | null;
  height: number | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

function mapUploadRowToContract(row: CardImageUploadRow): ImageUpload {
  return {
    id: row.id,
    projectId: row.project_id,
    cardId: row.card_id,
    version: row.version,
    state: row.finalized_image_id ? 'finalized' : row.state as any,
    expectedBytes: row.byte_length,
    receivedBytes: row.received_bytes,
    expiresAt: row.expires_at.toISOString(),
    serverNow: new Date().toISOString(),
    finalizedImageId: row.finalized_image_id,
    error: row.error,
  };
}

function mapFinalizedImageRowToContract(row: CardImageRow): FinalizedImage {
  return {
    id: row.id,
    projectId: row.project_id,
    cardId: row.card_id,
    filename: row.filename,
    byteLength: row.byte_length,
    contentType: row.content_type as any,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    uploaderId: row.uploader_id,
    version: row.version,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Stages a private image upload on an active card.
 * Enforces writer permissions (Owner, Manager, Member; Viewers rejected with 403),
 * card active status, and maximum 10 attachments per card.
 */
export async function createImageUpload(
  clientOrPool: pg.Pool | pg.ClientBase,
  actorId: string,
  cardId: string,
  input: CreateImageUploadInput,
): Promise<ImageUpload> {
  // Resolve card and verify ancestry
  const cardRes = await clientOrPool.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    board_id: string;
    state: string;
  }>(
    'SELECT id, workspace_id, project_id, board_id, state FROM cards WHERE id = $1',
    [cardId],
  );

  if (cardRes.rows.length === 0) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  const card = cardRes.rows[0]!;

  // Verify actor has project access and writer role
  await verifyProjectAncestry(clientOrPool, card.workspace_id, card.project_id, {
    id: card.id,
    type: 'card',
  });

  const role = await resolveProjectRole(card.project_id, actorId, clientOrPool);
  if (!role) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  await requireImageBoardAccess(clientOrPool, card.id, actorId);
  if (role === 'viewer') {
    throw HttpError.forbidden('Viewers cannot stage or upload image attachments.');
  }

  if (card.state !== 'active') {
    throw HttpError.conflict('Cannot attach images to a trashed or inactive card.', 'CARD_TRASHED');
  }

  // Enforce the attachment cap (B-11): finalized images plus staged uploads that have not expired.
  // The card row lock serialises concurrent stages for this card, so the count below is current
  // when the second request reads it. Callers run this inside the stage transaction.
  await clientOrPool.query('SELECT id FROM cards WHERE id = $1 FOR UPDATE', [card.id]);
  const countRes = await clientOrPool.query<{ count: string }>(
    `SELECT ((SELECT COUNT(*) FROM card_images WHERE card_id = $1)
           + (SELECT COUNT(*) FROM card_image_uploads
              WHERE card_id = $1 AND expires_at > NOW()
                AND state IN ('awaiting_content', 'content_received', 'validating')))::text AS count`,
    [card.id],
  );
  const currentCount = parseInt(countRes.rows[0]?.count ?? '0', 10);
  if (currentCount >= MAX_CARD_IMAGES) {
    throw HttpError.unprocessable(
      `Card already has maximum allowed attachments (${MAX_CARD_IMAGES}).`,
      'IMAGE_LIMIT_EXCEEDED',
    );
  }

  const uploadId = 'upl_' + crypto.randomUUID();
  const insertRes = await clientOrPool.query<CardImageUploadRow>(
    `INSERT INTO card_image_uploads (
       id, workspace_id, project_id, card_id, uploader_id,
       filename, byte_length, content_type, sha256, staging_storage_key,
       state, expires_at, version, received_bytes, error,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       'awaiting_content', NOW() + INTERVAL '1 hour', 1, NULL, NULL,
       NOW(), NOW()
     ) RETURNING *`,
    [
      uploadId,
      card.workspace_id,
      card.project_id,
      card.id,
      actorId,
      input.filename,
      input.byteLength,
      input.contentType,
      input.sha256,
      `staging/${uploadId}`,
    ],
  );

  return mapUploadRowToContract(insertRes.rows[0]!);
}

/**
 * Receives the raw binary payload for a staged image upload.
 * Verifies byte length, SHA-256 digest, and magic bytes / dimensions before staging.
 */
export async function receiveImageContent(
  clientOrPool: pg.Pool | pg.ClientBase,
  actorId: string,
  uploadId: string,
  rawBytes: Uint8Array,
  verification?: ImageVerificationTicket | null,
): Promise<ImageUpload> {
  const uploadRes = await clientOrPool.query<CardImageUploadRow>(
    'SELECT * FROM card_image_uploads WHERE id = $1 FOR UPDATE',
    [uploadId],
  );

  if (uploadRes.rows.length === 0) {
    throw HttpError.notFound('Upload staging record not found.', 'NOT_FOUND');
  }

  const upload = uploadRes.rows[0]!;
  await requireImageBoardAccess(clientOrPool, upload.card_id, actorId);

  // Verify actor has project access
  await verifyProjectAncestry(clientOrPool, upload.workspace_id, upload.project_id, {
    id: upload.id,
    type: 'upload',
  });

  // Verify actor is the uploader or project manager/owner
  const role = await resolveProjectRole(upload.project_id, actorId, clientOrPool);
  if (!role) {
    throw HttpError.notFound('Upload staging record not found.', 'NOT_FOUND');
  }
  if (actorId !== upload.uploader_id && role !== 'owner' && role !== 'manager') {
    throw HttpError.forbidden('Only the original uploader or a project manager can provide upload content.');
  }

  // Check upload state
  if (upload.state === 'finalized' || upload.finalized_image_id) {
    return mapUploadRowToContract(upload);
  }

  if (upload.state === 'cancelled') {
    throw HttpError.conflict('Upload staging has been cancelled.', 'UPLOAD_CANCELLED');
  }

  if (upload.state === 'expired' || upload.expires_at.getTime() < Date.now()) {
    await clientOrPool.query(
      `UPDATE card_image_uploads
       SET state = 'expired', updated_at = NOW(), version = version + 1
       WHERE id = $1`,
      [uploadId],
    );
    throw HttpError.badRequest('Upload staging has expired.', 'UPLOAD_EXPIRED');
  }

  // Length check
  if (rawBytes.byteLength !== upload.byte_length) {
    throw HttpError.badRequest(
      'The upload does not match what was declared. Start the upload again.',
      'SIZE_MISMATCH',
    );
  }

  // Digest check
  const actualHash = crypto.createHash('sha256').update(rawBytes).digest('hex').toLowerCase();
  if (actualHash !== upload.sha256.toLowerCase()) {
    throw HttpError.badRequest(
      `Payload SHA-256 digest (${actualHash}) does not match staged hash (${upload.sha256}).`,
      'DIGEST_MISMATCH',
    );
  }

  // Complete-container validation, dimensions and script/SVG rejection (no pixel decoding).
  try {
    validateImageBinary(rawBytes, upload.content_type as any, upload.sha256);
  } catch (err) {
    const code = err instanceof ImageValidationError ? err.code : 'INVALID_IMAGE';
    const message = err instanceof Error ? err.message : 'Invalid image binary';
    await clientOrPool.query(
      `UPDATE card_image_uploads
       SET state = 'failed',
           error = $2,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [uploadId, JSON.stringify({ code, message, retryable: false })],
    );
    throw HttpError.unprocessable(message, code);
  }

  requireVerificationTicket(verification, upload, actorId);
  const cardState=await clientOrPool.query<{state:string}>('SELECT state FROM cards WHERE id=$1 FOR SHARE',[upload.card_id]);
  if(cardState.rows[0]?.state!=='active') throw HttpError.conflict('Cannot attach images to an inactive card.','CARD_TRASHED');

  // Store staged object in storage driver
  const storage = getStorageDriver();
  const stagingKey = stagingKeyOf(upload);
  await storage.put(stagingKey, rawBytes, upload.content_type);

  await requireImageBoardAccess(clientOrPool, upload.card_id, actorId);

  // Update upload state to content_received
  const updateRes = await clientOrPool.query<CardImageUploadRow>(
    `UPDATE card_image_uploads
     SET state = 'content_received',
         received_bytes = $2,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $1 AND state IN ('awaiting_content', 'content_received')
     RETURNING *`,
    [uploadId, rawBytes.byteLength],
  );

  if (!updateRes.rows[0]) throw HttpError.conflict('Upload state changed.', 'INVALID_UPLOAD_STATE');
  return mapUploadRowToContract(updateRes.rows[0]);
}

// A ticket is minted only after full decode outside the mutation transaction. Its private
// record binds actor, upload version and digest; an HTTP body cannot manufacture one.
export interface ImageVerificationTicket {
  readonly verified: true;
}
const verificationTickets = new WeakMap<ImageVerificationTicket, {
  actorId: string;
  uploadId: string;
  version: number;
  sha256: string;
}>();
async function checkedBinary(upload: CardImageUploadRow, bytes: Uint8Array, signal: AbortSignal | undefined, deadlineAt: number) {
  if (bytes.byteLength !== upload.byte_length) throw HttpError.badRequest('The upload does not match what was declared. Start the upload again.', 'SIZE_MISMATCH');
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== upload.sha256.toLowerCase()) throw HttpError.badRequest('The upload does not match the staged digest.', 'DIGEST_MISMATCH');
  try {
    const dimensions = validateImageBinary(bytes, upload.content_type as any, upload.sha256);
    if (upload.content_type === 'image/jpeg') await validateJpegEntropy(bytes, signal, deadlineAt);
    if (upload.content_type === 'image/png') await validatePngPixelStream(bytes, signal, deadlineAt);
    return dimensions;
  } catch (error) {
    if (error instanceof ImageValidationError) throw HttpError.unprocessable(error.message, error.code);
    throw error;
  }
}
function requireVerificationTicket(ticket: ImageVerificationTicket | null | undefined, upload: CardImageUploadRow, actorId: string) {
  assertImageWorkActive();
  if (!ticket) throw imageVerificationUnavailable();
  const fact = verificationTickets.get(ticket);
  if (!fact || fact.actorId !== actorId || fact.uploadId !== upload.id || fact.version !== upload.version || fact.sha256 !== upload.sha256.toLowerCase()) throw HttpError.conflict('Upload changed during verification. Try again.', 'INVALID_UPLOAD_STATE');
}
export async function prepareImageVerification(pool: pg.Pool, actorId: string, uploadId: string, content?: Uint8Array, signal?: AbortSignal): Promise<ImageVerificationTicket | null> {
  const release = retainImageWork();
  try {
    const verificationStarted = Date.now();
    const verificationDeadline = verificationStarted + IMAGE_VERIFICATION_DEADLINE_MS;
    const upload = (await pool.query<CardImageUploadRow>('SELECT * FROM card_image_uploads WHERE id=$1', [uploadId])).rows[0];
    if (!upload) throw HttpError.notFound('Upload staging record not found.', 'NOT_FOUND');
    const access = await requireImageBoardAccess(pool, upload.card_id, actorId);
    if (access.role === 'viewer') throw HttpError.forbidden('Viewers cannot upload images.');
    if (actorId !== upload.uploader_id && access.role !== 'owner' && access.role !== 'manager') throw HttpError.forbidden('Only the uploader or a project manager can verify this upload.');
    if (upload.state === 'finalized' || upload.finalized_image_id) return null;
    if (upload.state === 'cancelled') throw HttpError.conflict('Upload staging has been cancelled.', 'UPLOAD_CANCELLED');
    if (upload.state === 'expired' || upload.expires_at.getTime() < Date.now()) throw HttpError.badRequest('Upload staging has expired.', 'UPLOAD_EXPIRED');
    if (!content && upload.state !== 'content_received') throw HttpError.conflict('Upload has no received content.', 'INVALID_UPLOAD_STATE');
    const bytes = content ?? (await getStorageDriver().get(stagingKeyOf(upload)))?.data;
    if (!bytes) throw HttpError.badRequest('Staged image content missing from storage.', 'CONTENT_MISSING');
    assertImageWorkActive();
    const dimensions = await checkedBinary(upload, bytes, signal, verificationDeadline);
    await verifyImagePixels(bytes, upload.content_type as any, dimensions, signal, verificationDeadline - Date.now());
    assertImageWorkActive();
    const ticket: ImageVerificationTicket = {
      verified: true
    };
    verificationTickets.set(ticket, {
      actorId,
      uploadId,
      version: upload.version,
      sha256: upload.sha256.toLowerCase()
    });
    return ticket;
  } finally {
    release();
  }
}

/**
 * Validates staged image bytes and finalizes the attachment to the card.
 * Enforces transaction atomicity, card locking, board version bump, and activity log.
 */
export async function finalizeImageUpload(
  clientOrPool: pg.Pool | pg.ClientBase,
  actorId: string,
  uploadId: string,
  verification?: ImageVerificationTicket | null,
): Promise<FinalizedImage> {
  const isPool = clientOrPool instanceof pg.Pool;
  const client = isPool ? await (clientOrPool as pg.Pool).connect() : clientOrPool as pg.ClientBase;

  try {
    if (isPool) await client.query('BEGIN');

    const initial = await client.query<CardImageUploadRow>('SELECT * FROM card_image_uploads WHERE id = $1', [uploadId]);
    if (!initial.rows[0]) throw HttpError.notFound('Upload staging record not found.', 'NOT_FOUND');
    const access = await requireImageBoardAccess(client, initial.rows[0].card_id, actorId);
    await acquireWriteGrantLock(client, access.projectId, actorId, 'member', access.boardId);

    // Lock upload record
    const uploadRes = await client.query<CardImageUploadRow>(
      'SELECT * FROM card_image_uploads WHERE id = $1 FOR UPDATE',
      [uploadId],
    );

    if (uploadRes.rows.length === 0) {
      throw HttpError.notFound('Upload staging record not found.', 'NOT_FOUND');
    }

    const upload = uploadRes.rows[0]!;

    // Verify project ancestry
    await verifyProjectAncestry(client, upload.workspace_id, upload.project_id, {
      id: upload.id,
      type: 'upload',
    });

    // Check actor role (uploader, manager, or owner)
    const role = await resolveProjectRole(upload.project_id, actorId, client);
    if (!role) {
      throw HttpError.notFound('Upload staging record not found.', 'NOT_FOUND');
    }
    if (actorId !== upload.uploader_id && role !== 'owner' && role !== 'manager') {
      throw HttpError.forbidden('Only the original uploader or a project manager can finalize an upload.');
    }

    // If already finalized, return existing finalized record (idempotency)
    if (upload.finalized_image_id) {
      const imgRes = await client.query<CardImageRow>(
        'SELECT * FROM card_images WHERE id = $1',
        [upload.finalized_image_id],
      );
      if (imgRes.rows.length > 0) {
        if (isPool) await client.query('COMMIT');
        return mapFinalizedImageRowToContract(imgRes.rows[0]!);
      }
    }

    if (upload.state !== 'content_received') {
      throw HttpError.conflict(
        `Upload cannot be finalized from state "${upload.state}". Must be "content_received".`,
        'INVALID_UPLOAD_STATE',
      );
    }

    if (upload.expires_at.getTime() < Date.now()) {
      await client.query(
        `UPDATE card_image_uploads
         SET state = 'expired', version = version + 1, updated_at = NOW()
         WHERE id = $1`,
        [uploadId],
      );
      throw HttpError.badRequest('Upload staging has expired.', 'UPLOAD_EXPIRED');
    }

    // Lock card row
    const cardRes = await client.query<{
      id: string;
      workspace_id: string;
      project_id: string;
      board_id: string;
      state: string;
      version: number;
    }>('SELECT id, workspace_id, project_id, board_id, state, version FROM cards WHERE id = $1 FOR UPDATE', [
      upload.card_id,
    ]);

    if (cardRes.rows.length === 0) {
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }

    const card = cardRes.rows[0]!;
    if (card.state !== 'active') {
      throw HttpError.conflict('Cannot attach image to a trashed or inactive card.', 'CARD_TRASHED');
    }

    // Verify card attachment limit under transaction lock
    const countRes = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM card_images WHERE card_id = $1',
      [card.id],
    );
    const currentCount = parseInt(countRes.rows[0]?.count ?? '0', 10);
    if (currentCount >= MAX_CARD_IMAGES) {
      await client.query(
        `UPDATE card_image_uploads
         SET state = 'failed',
             error = $2,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $1`,
        [
          uploadId,
          JSON.stringify({
            code: 'IMAGE_LIMIT_EXCEEDED',
            message: `Card already has maximum allowed attachments (${MAX_CARD_IMAGES}).`,
            retryable: false,
          }),
        ],
      );
      throw HttpError.unprocessable(
        `Card already has maximum allowed attachments (${MAX_CARD_IMAGES}).`,
        'IMAGE_LIMIT_EXCEEDED',
      );
    }

    // Retrieve staged bytes from storage driver
    const storage = getStorageDriver();
    const stagingKey = stagingKeyOf(upload);
    const stored = await storage.get(stagingKey);
    if (!stored) {
      throw HttpError.badRequest('Staged image content missing from storage.', 'CONTENT_MISSING');
    }

    // Recheck persisted bytes too: an older uploader may have accepted a malformed container.
    // Keep validation failures typed and roll back before any permanent storage/card effects.
    let validation: ReturnType<typeof validateImageBinary>;
    try {
      validation = validateImageBinary(stored.data, upload.content_type as any, upload.sha256);
    } catch (error) {
      if (error instanceof ImageValidationError) throw HttpError.unprocessable(error.message, error.code);
      throw error;
    }

    requireVerificationTicket(verification, upload, actorId);

    const imageId = 'img_' + crypto.randomUUID();
    // The object is already private and immutable for this upload. Promote its
    // database reference only: a failed COMMIT must leave exactly the original
    // known object for retry, not delete it and orphan a random copied object.
    const finalStorageKey = stagingKey;

    // Insert card_images record
    const insertImageRes = await client.query<CardImageRow>(
      `INSERT INTO card_images (
         id, workspace_id, project_id, card_id, uploader_id,
         filename, byte_length, content_type, storage_key, sha256,
         width, height, version, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, 1, NOW(), NOW()
       ) RETURNING *`,
      [
        imageId,
        upload.workspace_id,
        upload.project_id,
        upload.card_id,
        upload.uploader_id,
        upload.filename,
        upload.byte_length,
        upload.content_type,
        finalStorageKey,
        upload.sha256,
        validation.width,
        validation.height,
      ],
    );

    // Update upload record as finalized
    await client.query(
      `UPDATE card_image_uploads
       SET state = 'finalized',
           finalized_image_id = $2,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1`,
      [uploadId, imageId],
    );

    // Bump board version for snapshot invalidation
    await client.query(
      `UPDATE boards
       SET snapshot_version = snapshot_version + 1, updated_at = NOW()
       WHERE id = $1`,
      [card.board_id],
    );

    // Append to activity log
    await recordActivity(client, {
      workspaceId: card.workspace_id,
      projectId: card.project_id,
      boardId: card.board_id,
      cardId: card.id,
      actorId,
      action: 'image_attached',
      safeChanges: {
        imageId,
        filename: upload.filename,
        byteLength: upload.byte_length,
        contentType: upload.content_type,
        width: validation.width,
        height: validation.height,
      },
    });

    if (isPool) await client.query('COMMIT');
    return mapFinalizedImageRowToContract(insertImageRes.rows[0]!);
  } catch (err) {
    if (isPool) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (isPool && 'release' in client && typeof client.release === 'function') {
      client.release();
    }
  }
}

/**
 * Returns upload staging metadata for progress tracking.
 */
export async function getImageUpload(
  clientOrPool: pg.Pool | pg.ClientBase,
  actorId: string,
  uploadId: string,
): Promise<ImageUpload> {
  const uploadRes = await clientOrPool.query<CardImageUploadRow>(
    'SELECT * FROM card_image_uploads WHERE id = $1',
    [uploadId],
  );

  if (uploadRes.rows.length === 0) {
    throw HttpError.notFound('Upload staging record not found.', 'NOT_FOUND');
  }

  const upload = uploadRes.rows[0]!;
  await requireImageBoardAccess(clientOrPool, upload.card_id, actorId);
  await verifyProjectAncestry(clientOrPool, upload.workspace_id, upload.project_id, {
    id: upload.id,
    type: 'upload',
  });

  const role = await resolveProjectRole(upload.project_id, actorId, clientOrPool);
  if (!role) {
    throw HttpError.notFound('Upload staging record not found.', 'NOT_FOUND');
  }

  await requireImageBoardAccess(clientOrPool, upload.card_id, actorId);
  return mapUploadRowToContract(upload);
}

/**
 * Cancels a pending upload staging record and removes any staged bytes.
 */
export async function cancelImageUpload(
  clientOrPool: pg.ClientBase,
  actorId: string,
  uploadId: string,
): Promise<ImageUpload> {
  const uploadRes = await clientOrPool.query<CardImageUploadRow>(
    'SELECT * FROM card_image_uploads WHERE id = $1 FOR UPDATE',
    [uploadId],
  );

  if (uploadRes.rows.length === 0) {
    throw HttpError.notFound('Upload staging record not found.', 'NOT_FOUND');
  }

  const upload = uploadRes.rows[0]!;
  const access = await requireImageBoardAccess(clientOrPool, upload.card_id, actorId);
  await verifyProjectAncestry(clientOrPool, upload.workspace_id, upload.project_id, {
    id: upload.id,
    type: 'upload',
  });

  const role = await resolveProjectRole(upload.project_id, actorId, clientOrPool);
  if (!role) {
    throw HttpError.notFound('Upload staging record not found.', 'NOT_FOUND');
  }
  if (actorId !== upload.uploader_id && role !== 'owner' && role !== 'manager') {
    throw HttpError.forbidden('Only the original uploader or a project manager can cancel an upload.');
  }

  if (upload.state === 'finalized' || upload.finalized_image_id) {
    throw HttpError.conflict('Cannot cancel an upload that has already been finalized.', 'ALREADY_FINALIZED');
  }

  if (upload.state === 'cancelled') {
    return mapUploadRowToContract(upload);
  }

  if (!(clientOrPool instanceof pg.Pool)) {
    await acquireWriteGrantLock(clientOrPool as pg.ClientBase, access.projectId, actorId, 'member', access.boardId);
  }

  // Commit cleanup intent with cancellation. Object storage cannot roll back
  // with PostgreSQL; the mounted route performs deletion only after COMMIT.
  const stagingKey = stagingKeyOf(upload);
  await clientOrPool.query(
    `INSERT INTO pending_storage_deletions (storage_key) VALUES ($1)
     ON CONFLICT (storage_key) DO NOTHING`, [stagingKey],
  );

  const updateRes = await clientOrPool.query<CardImageUploadRow>(
    `UPDATE card_image_uploads
     SET state = 'cancelled', version = version + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [uploadId],
  );

  return mapUploadRowToContract(updateRes.rows[0]!);
}

/**
 * Lists finalized images on a card.
 */
export async function listCardImages(
  clientOrPool: pg.Pool | pg.ClientBase,
  actorId: string,
  cardId: string,
): Promise<{ items: FinalizedImage[]; totalCount: number }> {
  const cardRes = await clientOrPool.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    board_id: string;
    state: string;
  }>('SELECT id, workspace_id, project_id, board_id, state FROM cards WHERE id = $1', [cardId]);

  if (cardRes.rows.length === 0) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  const card = cardRes.rows[0]!;
  await verifyProjectAncestry(clientOrPool, card.workspace_id, card.project_id, {
    id: card.id,
    type: 'card',
  });

  const role = await resolveProjectRole(card.project_id, actorId, clientOrPool);
  if (!role) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  await requireImageBoardAccess(clientOrPool, card.id, actorId);

  // If card is trashed, only owner or manager can access
  if (card.state === 'trashed') {
    if (role !== 'owner' && role !== 'manager') {
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }
  }

  const imagesRes = await clientOrPool.query<CardImageRow>(
    `SELECT * FROM card_images
     WHERE card_id = $1
     ORDER BY created_at ASC, id ASC`,
    [card.id],
  );

  const items = imagesRes.rows.map(mapFinalizedImageRowToContract);
  await requireImageBoardAccess(clientOrPool, card.id, actorId);
  return { items, totalCount: items.length };
}

/**
 * Authenticated proxy delivery of image bytes (full content or thumbnail).
 * Checks project access on every single fetch; returns private, no-store response.
 */
export async function getImageContent(
  clientOrPool: pg.Pool | pg.ClientBase,
  actorId: string,
  imageId: string,
): Promise<{ data: Uint8Array; contentType: string; filename: string; byteLength: number; sha256: string }> {
  const imgRes = await clientOrPool.query<CardImageRow>(
    'SELECT * FROM card_images WHERE id = $1',
    [imageId],
  );

  if (imgRes.rows.length === 0) {
    throw HttpError.notFound('Image not found.', 'NOT_FOUND');
  }

  const image = imgRes.rows[0]!;
  await requireImageBoardAccess(clientOrPool, image.card_id, actorId);
  await verifyProjectAncestry(clientOrPool, image.workspace_id, image.project_id, {
    id: image.id,
    type: 'image',
  });

  const role = await resolveProjectRole(image.project_id, actorId, clientOrPool);
  if (!role) {
    throw HttpError.notFound('Image not found.', 'NOT_FOUND');
  }

  // Check card status
  const cardRes = await clientOrPool.query<{ state: string }>(
    'SELECT state FROM cards WHERE id = $1',
    [image.card_id],
  );
  const cardState = cardRes.rows[0]?.state;

  if (cardState === 'trashed') {
    // Only owner/manager can view trashed card attachments
    if (role !== 'owner' && role !== 'manager') {
      throw HttpError.notFound('Image not found.', 'NOT_FOUND');
    }
  }
  if (cardState !== 'active' && cardState !== 'trashed') {
    throw HttpError.notFound('Image not found.', 'NOT_FOUND');
  }

  const storage = getStorageDriver();
  const stored = await storage.get(image.storage_key);

  if (!stored) {
    throw HttpError.notFound('Image binary not found in storage.', 'NOT_FOUND');
  }

  await requireImageBoardAccess(clientOrPool, image.card_id, actorId);

  return {
    data: stored.data,
    contentType: image.content_type,
    filename: image.filename,
    byteLength: image.byte_length,
    sha256: image.sha256,
  };
}

/**
 * Removes an attached image from a card.
 * Enforces uploader or owner/manager authority, card active check, OCC version check,
 * board snapshot bump, and activity log recording.
 */
/**
 * Removes the image row inside the caller's transaction. The bytes are NOT deleted here: the key is
 * written to pending_storage_deletions in the same transaction. A rolled-back delete therefore
 * leaves both the row and the bytes. Call deleteStorageAfterCommit once the transaction commits.
 */
export async function deleteCardImage(
  clientOrPool: pg.Pool | pg.ClientBase,
  actorId: string,
  imageId: string,
  expectedVersion: number,
): Promise<{ result: { success: true; imageId: string }; storageKey: string }> {
  const isPool = clientOrPool instanceof pg.Pool;
  const client = isPool ? await (clientOrPool as pg.Pool).connect() : clientOrPool as pg.ClientBase;

  try {
    if (isPool) await client.query('BEGIN');

    const initial = await client.query<CardImageRow>('SELECT * FROM card_images WHERE id = $1', [imageId]);
    if (!initial.rows[0]) throw HttpError.notFound('Image not found.', 'NOT_FOUND');
    const access = await requireImageBoardAccess(client, initial.rows[0].card_id, actorId);
    await acquireWriteGrantLock(client, access.projectId, actorId, 'member', access.boardId);

    const imgRes = await client.query<CardImageRow>(
      'SELECT * FROM card_images WHERE id = $1 FOR UPDATE',
      [imageId],
    );

    if (imgRes.rows.length === 0) {
      throw HttpError.notFound('Image not found.', 'NOT_FOUND');
    }

    const image = imgRes.rows[0]!;
    await verifyProjectAncestry(client, image.workspace_id, image.project_id, {
      id: image.id,
      type: 'image',
    });

    // Check authority: must be uploader OR project manager OR workspace owner
    const role = await resolveProjectRole(image.project_id, actorId, client);
    if (!role) {
      throw HttpError.notFound('Image not found.', 'NOT_FOUND');
    }
    if (actorId !== image.uploader_id && role !== 'owner' && role !== 'manager') {
      throw HttpError.forbidden('Only the original uploader or a project manager can remove this image.');
    }

    // Check card status: cannot remove image from trashed card
    const cardRes = await client.query<{ id: string; board_id: string; state: string }>(
      'SELECT id, board_id, state FROM cards WHERE id = $1',
      [image.card_id],
    );
    const card = cardRes.rows[0];
    if (card && card.state === 'trashed') {
      throw HttpError.conflict('Cannot remove images from a trashed card.', 'CARD_TRASHED');
    }

    // OCC version check
    if (image.version !== expectedVersion) {
      throw HttpError.conflict(
        'This image changed since you loaded it. Reload to see the latest version.',
        'STALE_VERSION',
      );
    }

    // Delete database record, and record the bytes for deletion in the same transaction
    await client.query('DELETE FROM card_images WHERE id = $1', [imageId]);
    await client.query(
      `INSERT INTO pending_storage_deletions (storage_key) VALUES ($1)
       ON CONFLICT (storage_key) DO NOTHING`,
      [image.storage_key],
    );
    const deletedStorageKey = image.storage_key;

    // Bump board version
    if (card) {
      await client.query(
        'UPDATE boards SET snapshot_version = snapshot_version + 1, updated_at = NOW() WHERE id = $1',
        [card.board_id],
      );
    }

    // Record activity log
    await recordActivity(client, {
      workspaceId: image.workspace_id,
      projectId: image.project_id,
      boardId: card?.board_id,
      cardId: image.card_id,
      actorId,
      action: 'image_removed',
      safeChanges: { imageId: image.id, filename: image.filename },
    });

    if (isPool) await client.query('COMMIT');
    return { result: { success: true, imageId }, storageKey: deletedStorageKey };
  } catch (err) {
    if (isPool) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (isPool && 'release' in client && typeof client.release === 'function') {
      client.release();
    }
  }
}

/**
 * Deletes the bytes of a committed image deletion. A failure is not an error for the caller: the
 * image is already gone, and the pending_storage_deletions row stays for the purge job to retry.
 * On success the row is removed.
 */
export async function deleteStorageAfterCommit(client: pg.ClientBase, storageKey: string): Promise<void> {
  try {
    await getStorageDriver().delete(storageKey);
  } catch {
    return;
  }
  await client.query('DELETE FROM pending_storage_deletions WHERE storage_key = $1', [storageKey]).catch(() => {});
}

/**
 * Settle expired/cancelled/failed staging once. A finalized upload stays finalized:
 * its object may now be the live image object, so reference checks follow the
 * upload locks in a fresh statement. Only unreferenced keys enter the durable
 * deletion queue. Legacy separate staging keys remain eligible for cleanup.
 * Storage deletion happens after commit; failures keep their retryable keys.
 */
export async function cleanupOrphanUploads(
  pool: pg.Pool,
  limit = 100,
): Promise<{ cleanedCount: number }> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw HttpError.badRequest('Cleanup batch size must be between1 and100.', 'INVALID_LIMIT');
  const client = await pool.connect();
  let settled: Array<{ id: string; card_id: string; filename: string; staging_storage_key: string | null }> = [];
  const keys: string[] = [];
  try {
    await client.query('BEGIN');
    const rows = await client.query<{ id: string; card_id: string; filename: string; staging_storage_key: string | null }>(
      `SELECT u.id, u.card_id, u.filename, u.staging_storage_key
       FROM card_image_uploads u
       WHERE u.staging_cleaned = FALSE
         AND (u.state IN ('expired', 'cancelled', 'failed') OR u.expires_at < NOW())
       ORDER BY u.expires_at ASC, u.id ASC
       LIMIT $1
       FOR UPDATE OF u SKIP LOCKED`,
      [limit],
    );
    settled = rows.rows;
    // LockRows can return a just-committed finalized tuple after this SELECT's
    // snapshot was taken. Only a new READ COMMITTED statement sees the matching
    // image insert. All upload locks remain held, so a later finalizer cannot race
    // this bounded batch check. REPEATABLE READ aborts on a changed locked tuple.
    const referenced = settled.length ? await client.query<{ storage_key:string }>(
      `SELECT DISTINCT storage_key FROM card_images
       WHERE card_id=ANY($1::text[]) AND storage_key=ANY($2::text[])`,
      [[...new Set(settled.map(upload=>upload.card_id))],settled.map(stagingKeyOf)],
    ) : {rows:[]};
    const referencedKeys = new Set(referenced.rows.map(row=>row.storage_key));
    for (const upload of settled) {
      if (!referencedKeys.has(stagingKeyOf(upload))) {
        const key=stagingKeyOf(upload);
        keys.push(key);
        await client.query(
        `INSERT INTO pending_storage_deletions (storage_key) VALUES ($1)
         ON CONFLICT (storage_key) DO NOTHING`,
        [key],
        );
      }
      // Version moves only when the state actually changes (a non-terminal row becomes expired).
      await client.query(
        `UPDATE card_image_uploads
         SET version = version + CASE WHEN finalized_image_id IS NOT NULL AND state<>'finalized' THEN 1
                                      WHEN state IN ('finalized', 'expired', 'cancelled', 'failed') THEN 0 ELSE 1 END,
             state = CASE WHEN state='finalized' OR finalized_image_id IS NOT NULL THEN 'finalized'
                          WHEN state IN ('expired', 'cancelled', 'failed') THEN state ELSE 'expired' END,
             staging_cleaned = TRUE,
             updated_at = NOW()
         WHERE id = $1`,
        [upload.id],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const storage = keys.length ? getStorageDriver() : null;
  for (const key of keys) {
    try {
      await storage!.delete(key);
      await pool.query('DELETE FROM pending_storage_deletions WHERE storage_key = $1', [key]);
    } catch {
      // Stays in pending_storage_deletions; processPendingStorageDeletions retries it.
    }
  }
  return { cleanedCount: settled.length };
}
