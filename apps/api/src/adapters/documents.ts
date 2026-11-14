import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { documentMediaTypeForFilename, MAX_CARD_DOCUMENTS, type CardDocument, type Role } from '@flowboard/contracts';
import { HttpError } from '../http/errors.ts';
import { recordActivity } from './activity.ts';
import { lockBoardAccess } from './board-grants-foundation.ts';
import { canonicalJson, checkOrReplayReceipt, saveReceipt, sha256 } from './idempotency.ts';
import { acquireWritableProjectContextLock, acquireWriteGrantLock } from './rbac.ts';

type DocumentActor = { id: string; sessionId: string };
type CardContext = { id: string; project_id: string; workspace_id: string; board_id: string };
type DocumentRow = {
  id: string; card_id: string; uploader_id: string; filename: string; byte_length: number;
  original_byte_length: number; sha256: string; storage_key: string; created_at: Date;
  deleted_at: Date | null;
};
type UploadInput = { filename: string; inputSha256: string; originalByteLength: number };
type VerifiedMetadata = { sha256: string; byteLength: number };

const notFound = () => HttpError.notFound('Card or document not found.');
const admin = (role: Role) => role === 'owner' || role === 'manager';
const removable = (role: Role, actorId: string, uploaderId: string) => role !== 'viewer' && (admin(role) || actorId === uploaderId);
const payloadHash = (path: string, input: UploadInput) => sha256(canonicalJson({ path, input }));

async function transaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

// authMiddleware supplies the hashed session ID. A sign-out can revoke access while scanning
// or fetching a private object, so serialize the final decision with deletion of that session.
async function lockSession(client: pg.PoolClient, actor: DocumentActor) {
  const session = await client.query(`SELECT 1 FROM sessions
    WHERE id=$1 AND user_id=$2 AND expires_at > clock_timestamp() FOR SHARE`, [actor.sessionId, actor.id]);
  if (!session.rowCount) throw HttpError.unauthorized();
}

async function lockCard(client: pg.PoolClient, cardId: string, actor: DocumentActor, write: boolean) {
  await lockSession(client, actor);
  const peek = (await client.query<CardContext>(
    'SELECT id, project_id, workspace_id, board_id FROM cards WHERE id=$1', [cardId],
  )).rows[0];
  if (!peek) throw notFound();
  const {role} = write ? await acquireWriteGrantLock(client, peek.project_id, actor.id, 'member', peek.board_id)
    : await lockBoardAccess(client, peek.board_id, actor.id);
  if (write) await acquireWritableProjectContextLock(client, peek.project_id, peek.board_id);
  const context = (await client.query<CardContext & { state: string; restorable: boolean; archived: boolean }>(
    `SELECT c.id,c.project_id,c.workspace_id,c.board_id,c.state,
            c.restore_until > clock_timestamp() AS restorable,
            (p.archived OR b.archived) AS archived
       FROM cards c JOIN boards b ON b.id=c.board_id JOIN projects p ON p.id=c.project_id
       WHERE c.id=$1 AND c.project_id=$2 AND c.workspace_id=$3 AND c.board_id=$4
       FOR ${write ? 'UPDATE' : 'SHARE'} OF c`, [cardId, peek.project_id, peek.workspace_id, peek.board_id],
  )).rows[0];
  if (!context || (context.state !== 'active' && (write || context.state !== 'trashed' || !context.restorable || !admin(role)))) throw notFound();
  return { ...context, role, canWrite: context.state === 'active' && !context.archived && role !== 'viewer' };
}

function wire(row: DocumentRow, writable: boolean, role: Role, actorId: string): CardDocument {
  const mediaType = documentMediaTypeForFilename(row.filename);
  if (!mediaType) throw new HttpError(503, 'DOCUMENT_PROCESSOR_UNAVAILABLE', 'Document metadata is unavailable.');
  return { id: row.id, cardId: row.card_id, uploaderId: row.uploader_id, filename: row.filename,
    mediaType, byteLength: row.byte_length, originalByteLength: row.original_byte_length, createdAt: row.created_at.toISOString(),
    canRemove: writable && removable(role, actorId, row.uploader_id) };
}

export async function confirmDocumentUploadAccess(pool: pg.Pool, actor: DocumentActor, cardId: string) {
  await transaction(pool, client => lockCard(client, cardId, actor, true));
}

export function listCardDocuments(pool: pg.Pool, actor: DocumentActor, cardId: string) {
  return transaction(pool, async client => {
    const card = await lockCard(client, cardId, actor, false);
    const res = await client.query<DocumentRow>(`SELECT * FROM card_documents WHERE card_id=$1 AND deleted_at IS NULL ORDER BY created_at,id`, [card.id]);
    return { items: res.rows.map(row => wire(row, card.canWrite, card.role, actor.id)), count: res.rows.length,
      canUpload: card.canWrite };
  });
}

export function getCardDocument(pool: pg.Pool, actor: DocumentActor, documentId: string) {
  return transaction(pool, async client => {
    const peek = (await client.query<{ card_id: string }>('SELECT card_id FROM card_documents WHERE id=$1 AND deleted_at IS NULL', [documentId])).rows[0];
    if (!peek) throw notFound();
    const card = await lockCard(client, peek.card_id, actor, false);
    const row = (await client.query<DocumentRow>('SELECT * FROM card_documents WHERE id=$1 AND card_id=$2 AND deleted_at IS NULL', [documentId, card.id])).rows[0];
    if (!row) throw notFound();
    return row;
  });
}

function uploadPath(cardId: string) { return `POST /api/v1/cards/${cardId}/documents`; }

/** The caller scans and stores outside these transactions. Every decision starts from current access. */
export function prepareDocumentUpload(pool: pg.Pool, actor: DocumentActor, cardId: string, key: string, input: UploadInput, reserve: boolean, signal: AbortSignal) {
  return transaction(pool, async client => {
    const card = await lockCard(client, cardId, actor, true);
    signal.throwIfAborted();
    const path = uploadPath(card.id);
    const receipt = await checkOrReplayReceipt(client, actor.id, 'project', card.project_id, key, path, input);
    if (receipt) {
      const id = (receipt.responseBody as { data?: { id?: string } }).data?.id;
      const row = (await client.query<DocumentRow>('SELECT * FROM card_documents WHERE id=$1 AND card_id=$2 AND deleted_at IS NULL', [id, card.id])).rows[0];
      if (!row) throw notFound();
      return { kind: 'replay', document: wire(row, card.canWrite, card.role, actor.id) } as const;
    }
    const waiting = (await client.query<{storage_key:string; payload_sha256:string; active:boolean}>(`SELECT storage_key,payload_sha256,
      expires_at > clock_timestamp() AS active FROM card_document_reservations
      WHERE project_id=$1 AND uploader_id=$2 AND idempotency_key=$3 FOR UPDATE`, [card.project_id,actor.id,key])).rows[0];
    if (waiting?.active) {
      if (waiting.payload_sha256 !== payloadHash(path,input)) throw HttpError.conflict('IDEMPOTENCY_CONFLICT','Idempotency key collision with different request payload.');
      throw HttpError.conflict('DOCUMENT_UPLOAD_IN_PROGRESS','This upload is being saved. Retry with the same key.');
    }

    const counts = (await client.query<{ saved: number; pending: number }>(`SELECT
      (SELECT count(*)::int FROM card_documents WHERE card_id=$1 AND deleted_at IS NULL) AS saved,
      (SELECT count(*)::int FROM card_document_reservations WHERE card_id=$1 AND expires_at > clock_timestamp()) AS pending`, [card.id])).rows[0]!;
    if (counts.saved >= MAX_CARD_DOCUMENTS) throw HttpError.conflict('DOCUMENT_LIMIT_REACHED', `A card can hold ${MAX_CARD_DOCUMENTS} documents.`);
    if (counts.saved + counts.pending >= MAX_CARD_DOCUMENTS || counts.pending >= 2) {
      throw HttpError.conflict('DOCUMENT_UPLOAD_IN_PROGRESS', 'Other uploads are being saved to this card. Try again shortly.');
    }
    if (!reserve) return { kind: 'scan' } as const;
    if (waiting) await client.query('UPDATE card_document_reservations SET idempotency_key=NULL WHERE storage_key=$1', [waiting.storage_key]);
    const storageKey = `documents/${randomUUID()}`;
    await client.query(`INSERT INTO card_document_reservations
      (storage_key,card_id,project_id,workspace_id,uploader_id,idempotency_key,payload_sha256)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`, [storageKey,card.id,card.project_id,card.workspace_id,actor.id,key,payloadHash(path,input)]);
    signal.throwIfAborted();
    return { kind: 'reserved', storageKey } as const;
  });
}

export function publishCardDocument(pool: pg.Pool, actor: DocumentActor, cardId: string, key: string, input: UploadInput,
  metadata: VerifiedMetadata, storageKey: string, signal: AbortSignal): Promise<CardDocument> {
  return transaction(pool, async client => {
    const card = await lockCard(client, cardId, actor, true);
    signal.throwIfAborted();
    const path = uploadPath(card.id);
    // Preserve the same lock order as reservation. No expiration-based cleanup can remove a live row.
    const receipt = await checkOrReplayReceipt(client, actor.id, 'project', card.project_id, key, path, input);
    if (receipt) throw HttpError.conflict('DOCUMENT_UPLOAD_IN_PROGRESS','Retry this upload with the same key.');
    const reserved = await client.query(`DELETE FROM card_document_reservations WHERE storage_key=$1 AND card_id=$2
      AND project_id=$3 AND workspace_id=$4 AND uploader_id=$5 AND idempotency_key=$6 AND payload_sha256=$7
      AND expires_at > clock_timestamp()`, [storageKey,card.id,card.project_id,card.workspace_id,actor.id,key,payloadHash(path,input)]);
    if (!reserved.rowCount) throw HttpError.conflict('DOCUMENT_UPLOAD_IN_PROGRESS','This upload expired. Retry with the same key.');

    const documentId = `doc_${randomUUID()}`;
    const res = await client.query<DocumentRow>(`INSERT INTO card_documents
      (id,card_id,project_id,workspace_id,uploader_id,filename,byte_length,original_byte_length,sha256,storage_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [documentId,card.id,card.project_id,card.workspace_id,actor.id,input.filename,metadata.byteLength,input.originalByteLength,metadata.sha256,storageKey]);
    await recordActivity(client, { workspaceId: card.workspace_id, projectId:card.project_id, boardId:card.board_id,
      cardId:card.id, actorId:actor.id, action:'document_attached', safeChanges:{documentId} });
    await saveReceipt(client, actor.id, 'project', card.project_id, key, path, input, 201, {data:{id:documentId}});
    signal.throwIfAborted();
    return wire(res.rows[0]!, true, card.role, actor.id);
  });
}

export function removeCardDocument(pool: pg.Pool, actor: DocumentActor, documentId: string, key: string,
  signal: AbortSignal) {
  return transaction(pool, async client => {
    const peek = (await client.query<{ card_id: string }>('SELECT card_id FROM card_documents WHERE id=$1', [documentId])).rows[0];
    if (!peek) throw notFound();
    const card = await lockCard(client, peek.card_id, actor, true);
    signal.throwIfAborted();
    const row = (await client.query<DocumentRow>('SELECT * FROM card_documents WHERE id=$1 AND card_id=$2', [documentId, card.id])).rows[0];
    if (!row) throw notFound();
    if (!removable(card.role, actor.id, row.uploader_id)) throw HttpError.forbidden('Only the uploader or a project administrator can remove this document.');
    const path = `DELETE /api/v1/documents/${documentId}`;
    const receipt = await checkOrReplayReceipt(client, actor.id, 'project', card.project_id, key, path, {});
    if (receipt) return true;
    if (row.deleted_at) throw notFound();
    await client.query(`INSERT INTO pending_storage_deletions (storage_key) VALUES ($1) ON CONFLICT (storage_key) DO NOTHING`, [row.storage_key]);
    await client.query(`UPDATE card_documents SET deleted_at=clock_timestamp(), filename=NULL,
      byte_length=NULL, original_byte_length=NULL, sha256=NULL, storage_key=NULL WHERE id=$1`, [documentId]);
    await recordActivity(client, { workspaceId:card.workspace_id, projectId:card.project_id, boardId:card.board_id,
      cardId:card.id, actorId:actor.id, action:'document_removed', safeChanges:{ documentId } });
    await saveReceipt(client, actor.id, 'project', card.project_id, key, path, {}, 200, { data:{ id:documentId,success:true } });
    signal.throwIfAborted();
    return false;
  });
}

/** The PUT adapter must guarantee no new storage commit past the reservation's reclaim horizon.
 * If the call settles successfully, an earlier transactional reclaim is safe even after ambiguous DB COMMIT.
 */
export async function releaseSettledDocumentReservation(pool: pg.Pool, storageKey: string) {
  await pool.query(`UPDATE card_document_reservations SET idempotency_key=NULL,
    expires_at=clock_timestamp(), reclaim_at=clock_timestamp() + INTERVAL '1 second' WHERE storage_key=$1`, [storageKey]);
}

/** Explicit local job entry. Deployed runtime cannot enable documents before its cleanup is wired. */
export async function cleanupCardDocuments(pool: pg.Pool) {
  const queued = (await pool.query(`WITH eligible AS (
    SELECT storage_key FROM card_document_reservations WHERE reclaim_at <= clock_timestamp()
    ORDER BY reclaim_at, storage_key LIMIT 50 FOR UPDATE SKIP LOCKED
  ), removed AS (
    DELETE FROM card_document_reservations r USING eligible e WHERE r.storage_key=e.storage_key RETURNING r.storage_key
  ) INSERT INTO pending_storage_deletions (storage_key) SELECT storage_key FROM removed
    ON CONFLICT (storage_key) DO NOTHING`)).rowCount ?? 0;
  // Keep only the tombstone necessary to authorize a seven-day deletion-receipt replay.
  const removed = (await pool.query(`WITH eligible AS (
    SELECT id FROM card_documents WHERE deleted_at < clock_timestamp() - INTERVAL '8 days'
    ORDER BY deleted_at, id LIMIT 50 FOR UPDATE SKIP LOCKED
  ) DELETE FROM card_documents d USING eligible e WHERE d.id=e.id`)).rowCount ?? 0;
  return { queued, removed };
}
