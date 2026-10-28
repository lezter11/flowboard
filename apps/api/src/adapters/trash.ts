import crypto from 'node:crypto';
import type pg from 'pg';
import {
  type Card,
  type CardState,
  type Priority,
  type TrashRow,
  type TrashBlockedReason,
  type PersonDisplay,
  type SoftDeleteCardInput,
  type RestoreCardInput,
  softDeleteCardInputSchema,
  restoreCardInputSchema,
  parseOrThrow,
} from '@flowboard/contracts';
import { HttpError } from '../http/errors.ts';
import { getPool } from './postgres.ts';
import {
  resolveProjectRole,
  acquireWriteGrantLock,
  acquireWritableProjectContextLock,
  getHistoricalPersonDisplay,
} from './rbac.ts';
import { recordActivity } from './activity.ts';
import { lockBoardAccess } from './board-grants-foundation.ts';

async function lockCardBoard(client: pg.ClientBase, cardId: string, actorId: string): Promise<void> {
  const context = await client.query<{ board_id: string }>(
    'SELECT board_id FROM cards WHERE id = $1', [cardId],
  );
  if (!context.rows[0]) throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  await lockBoardAccess(client, context.rows[0].board_id, actorId);
}

export interface ListTrashResult {
  data: TrashRow[];
  nextCursor: string | null;
  serverNow: string;
}

export interface TrashCursorPayload {
  pId: string;
  dAt: string;
  id: string;
}

export function encodeTrashCursor(payload: TrashCursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeTrashCursor(cursor?: string): TrashCursorPayload | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.pId === 'string' &&
      typeof parsed.dAt === 'string' &&
      typeof parsed.id === 'string'
    ) {
      return parsed as TrashCursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetches a complete Card contract object with calculated comment and image counts and assignees.
 */
export async function fetchCardWithCounts(
  clientOrPool: pg.Pool | pg.ClientBase,
  cardId: string,
): Promise<Card | null> {
  const pool = clientOrPool ?? getPool();

  const res = await pool.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    board_id: string;
    column_id: string;
    title: string;
    description: string | null;
    priority: Priority;
    due_date: Date | string | null;
    position: string | number;
    version: number;
    state: CardState;
    deleted_at: Date | null;
    deleted_by: string | null;
    restore_until: Date | null;
    created_at: Date;
    updated_at: Date;
    comment_count: string;
    image_count: string;
    assignee_ids: string[] | null;
  }>(
    `SELECT 
       c.*,
       (SELECT COUNT(*)::text FROM comments cm WHERE cm.card_id = c.id AND cm.deleted_at IS NULL) AS comment_count,
       (SELECT COUNT(*)::text FROM card_images ci WHERE ci.card_id = c.id) AS image_count,
       (SELECT COALESCE(array_agg(ca.user_id), '{}') FROM card_assignees ca WHERE ca.card_id = c.id) AS assignee_ids
     FROM cards c
     WHERE c.id = $1`,
    [cardId],
  );

  if (res.rows.length === 0 || !res.rows[0]) {
    return null;
  }

  const row = res.rows[0];
  let dueDateStr: string | null = null;
  if (row.due_date) {
    if (typeof row.due_date === 'string') {
      dueDateStr = row.due_date.slice(0, 10);
    } else if (row.due_date instanceof Date) {
      dueDateStr = row.due_date.toISOString().slice(0, 10);
    }
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    boardId: row.board_id,
    columnId: row.column_id,
    title: row.title,
    description: row.description ?? '',
    priority: row.priority,
    dueDate: dueDateStr,
    assigneeIds: row.assignee_ids ?? [],
    position: Number(row.position),
    version: row.version,
    state: row.state,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    deletedBy: row.deleted_by ?? null,
    restoreUntil: row.restore_until ? new Date(row.restore_until).toISOString() : null,
    commentCount: parseInt(row.comment_count, 10) || 0,
    imageCount: parseInt(row.image_count, 10) || 0,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Retrieves a single active card by ID for normal readers.
 * Trashed and purged cards return 404 NOT_FOUND (DEL-08).
 * Outsiders return 404 NOT_FOUND.
 */
export async function getCardById(
  clientOrPool: pg.Pool | pg.ClientBase,
  cardId: string,
  actorId: string,
): Promise<Card> {
  const pool = clientOrPool ?? getPool();

  const card = await fetchCardWithCounts(pool, cardId);
  if (!card || card.state === 'trashed' || card.state === 'purged') {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  const role = await resolveProjectRole(card.projectId, actorId, pool);
  if (!role) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }
  if (role !== 'owner') {
    const grant = await pool.query(
      'SELECT 1 FROM board_grants WHERE board_id = $1 AND project_id = $2 AND user_id = $3',
      [card.boardId, card.projectId, actorId],
    );
    if (!grant.rows[0]) throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  return card;
}

/**
 * Soft deletes a card (DEL-01).
 * - Requires workspace owner or project manager role via acquireWriteGrantLock (members/viewers receive 403).
 * - Card must be active (rejects trashed/purged cards).
 * - OCC check: expectedVersion matches card.version and expectedBoardVersion matches board.structure_version.
 * - Sets state = 'trashed', deleted_at = NOW(), deleted_by = actorId, restore_until = NOW() + INTERVAL '24 hours'.
 * - Increments board structure_version and snapshot_version.
 * - Writes activity_log fact.
 * - Returns updated card.
 */
export async function deleteCard(
  client: pg.ClientBase,
  cardId: string,
  input: SoftDeleteCardInput,
  actorId: string,
): Promise<Card> {
  const validated = parseOrThrow(softDeleteCardInputSchema, input);
  await lockCardBoard(client, cardId, actorId);

  // 1. Fetch card and board details with row lock
  const cardRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    board_id: string;
    column_id: string;
    title: string;
    position: number | string;
    version: number;
    state: CardState;
    board_structure_version: number;
    board_snapshot_version: number;
  }>(
    `SELECT c.id, c.workspace_id, c.project_id, c.board_id, c.column_id, c.title, c.position, c.version, c.state,
            b.structure_version AS board_structure_version, b.snapshot_version AS board_snapshot_version
     FROM cards c
     JOIN boards b ON c.board_id = b.id
     WHERE c.id = $1
     FOR UPDATE`,
    [cardId],
  );

  if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  const card = cardRes.rows[0];

  if (card.state === 'trashed') {
    throw HttpError.conflict('CARD_ALREADY_TRASHED', 'Card is already trashed.');
  }
  if (card.state === 'purged') {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  // 2. Authorization check: Owner or Manager only (DEL-01: members/viewers receive 403)
  await acquireWriteGrantLock(client, card.project_id, actorId, 'manager', card.board_id);
  await acquireWritableProjectContextLock(client, card.project_id, card.board_id);

  // 3. OCC checks
  if (card.version !== validated.expectedVersion) {
    throw HttpError.conflict('STALE_VERSION', 'Card version does not match expected version.');
  }
  if (card.board_structure_version !== validated.expectedBoardVersion) {
    throw HttpError.conflict('STALE_VERSION', 'Board structure version does not match expected board version.');
  }

  // Determine surrounding anchors before soft deleting for re-anchoring on restore
  const neighborRes = await client.query<{ id: string; position: number }>(
    `SELECT id, position
     FROM cards
     WHERE column_id = $1 AND state = 'active' AND id != $2
     ORDER BY cards.position ASC, cards.id ASC`,
    [card.column_id, cardId],
  );
  const cardPos = Number(card.position);
  const prevNeighbors = neighborRes.rows.filter((r) => Number(r.position) < cardPos);
  const nextNeighbors = neighborRes.rows.filter((r) => Number(r.position) > cardPos);
  const previousCardId = prevNeighbors.length > 0 ? prevNeighbors[prevNeighbors.length - 1]!.id : null;
  const nextCardId = nextNeighbors.length > 0 ? nextNeighbors[0]!.id : null;

  const now = new Date();
  const nowIso = now.toISOString();

  // 4. Update card to trashed state with 24-hour restore window
  await client.query(
    `UPDATE cards
     SET state = 'trashed',
         deleted_at = $1,
         deleted_by = $2,
         restore_until = $1::timestamptz + INTERVAL '24 hours',
         version = version + 1,
         updated_at = $1
     WHERE id = $3`,
    [nowIso, actorId, cardId],
  );

  // 5. Increment board structure_version and snapshot_version
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = $1
     WHERE id = $2`,
    [nowIso, card.board_id],
  );

  // 6. Record activity_log fact (minimal metadata; does not leak card title)
  await recordActivity(client, {
    workspaceId: card.workspace_id,
    projectId: card.project_id,
    boardId: card.board_id,
    cardId: card.id,
    actorId,
    action: 'card_trashed',
    safeChanges: {
      cardId: card.id,
      previousCardId,
      nextCardId,
      originalPosition: cardPos,
    },
    createdAt: nowIso,
  });

  const updatedCard = await fetchCardWithCounts(client, cardId);
  if (!updatedCard) {
    throw new Error('Failed to retrieve trashed card');
  }

  return updatedCard;
}

/**
 * Lists trashed cards in a project for administrators (DEL-02).
 * - Requires workspace owner or project manager role (members/viewers receive 403, outsiders 404).
 * - Computes canRestore and blockedReason for each card.
 * - Attaches deletedBy PersonDisplay identity.
 */
export async function listProjectTrash(
  clientOrPool: pg.Pool | pg.ClientBase,
  projectId: string,
  actorId: string,
  options?: { limit?: number | undefined; cursor?: string | undefined; authorizedBoardIds?: string[] | undefined } | undefined,
): Promise<ListTrashResult> {
  const pool = clientOrPool ?? getPool();

  // 1. Authorization check
  const role = await resolveProjectRole(projectId, actorId, pool);
  if (!role) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }
  if (role !== 'owner' && role !== 'manager') {
    throw HttpError.forbidden('Only workspace owner or project manager can view trash.', 'FORBIDDEN');
  }

  const serverNow = new Date().toISOString();
  const serverNowTime = new Date(serverNow).getTime();

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  let cursorPayload: TrashCursorPayload | null = null;
  if (options?.cursor) {
    cursorPayload = decodeTrashCursor(options.cursor);
    if (!cursorPayload || cursorPayload.pId !== projectId) {
      throw HttpError.conflict('Stale or malformed pagination cursor.', 'STALE_CURSOR');
    }
  }

  const params: unknown[] = [projectId];
  let cursorClause = '';
  if (cursorPayload) {
    params.push(cursorPayload.dAt, cursorPayload.id);
    cursorClause = ` AND (c.deleted_at < $2::timestamptz OR (c.deleted_at = $2::timestamptz AND c.id < $3))`;
  }

  let grantJoin = '';
  if (role !== 'owner') {
    params.push(actorId);
    const actorIdx = params.length;
    grantJoin = ` JOIN board_grants bg ON bg.board_id = c.board_id AND bg.project_id = c.project_id AND bg.user_id = $${actorIdx}`;
  }

  let lockedBoardClause = '';
  if (role !== 'owner' && options?.authorizedBoardIds) {
    params.push(options.authorizedBoardIds);
    lockedBoardClause = ` AND c.board_id = ANY($${params.length}::text[])`;
  }

  params.push(limit + 1);
  const limitIdx = params.length;

  // 2. Query trashed cards with column and context metadata
  const res = await pool.query<{
    id: string;
    title: string;
    project_id: string;
    board_id: string;
    original_column_id: string;
    version: number;
    structure_version: number;
    deleted_at: Date;
    deleted_by: string;
    restore_until: Date;
    project_archived: boolean;
    board_archived: boolean;
    existing_column_id: string | null;
    actor_id: string | null;
    actor_name: string | null;
    actor_avatar: string | null;
    card_key: string;
  }>(
    `SELECT 
       c.id,
       c.title,
       p.key_prefix || '-' || c.card_number::text AS card_key,
       c.project_id,
       c.board_id,
       c.column_id AS original_column_id,
       c.version,
       b.structure_version,
       c.deleted_at,
       c.deleted_by,
       c.restore_until,
       p.archived AS project_archived,
       b.archived AS board_archived,
       col.id AS existing_column_id,
       u.id AS actor_id,
       u.display_name AS actor_name,
       u.avatar_url AS actor_avatar
     FROM cards c
     JOIN boards b ON c.board_id = b.id
     JOIN projects p ON c.project_id = p.id${grantJoin}
     LEFT JOIN columns col ON col.id = c.column_id AND col.board_id = c.board_id
     LEFT JOIN users u ON u.id = c.deleted_by
     WHERE c.project_id = $1 AND c.state = 'trashed'${cursorClause}${lockedBoardClause}
     ORDER BY c.deleted_at DESC, c.id DESC
     LIMIT $${limitIdx}`,
    params,
  );

  const hasMore = res.rows.length > limit;
  const pageRows = hasMore ? res.rows.slice(0, limit) : res.rows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? encodeTrashCursor({
          pId: projectId,
          dAt: new Date(lastRow.deleted_at).toISOString(),
          id: lastRow.id,
        })
      : null;

  const trashRows: TrashRow[] = pageRows.map((row) => {
    const restoreUntilIso = new Date(row.restore_until).toISOString();
    const restoreUntilTime = new Date(restoreUntilIso).getTime();

    let canRestore = true;
    let blockedReason: TrashBlockedReason = null;

    if (serverNowTime >= restoreUntilTime) {
      canRestore = false;
      blockedReason = 'window_expired';
    } else if (row.project_archived) {
      canRestore = false;
      blockedReason = 'project_archived';
    } else if (row.board_archived) {
      canRestore = false;
      blockedReason = 'board_archived';
    } else if (!row.existing_column_id) {
      canRestore = false;
      blockedReason = 'destination_missing';
    }

    const actorDisplay: PersonDisplay | undefined = row.actor_id
      ? {
          id: row.actor_id,
          displayName: row.actor_name ?? 'Teammate',
          avatarUrl: row.actor_avatar ?? null,
          activeInProject: true,
          scopedRole: 'manager',
          assignable: true,
          mentionable: true,
        }
      : undefined;

    return {
      id: row.id,
      title: row.title,
      key: row.card_key,
      projectId: row.project_id,
      boardId: row.board_id,
      originalColumnId: row.original_column_id,
      version: row.version,
      structureVersion: row.structure_version,
      deletedAt: new Date(row.deleted_at).toISOString(),
      deletedBy: row.deleted_by,
      restoreUntil: restoreUntilIso,
      canRestore,
      blockedReason,
      actor: actorDisplay,
    };
  });

  return {
    data: trashRows,
    nextCursor,
    serverNow,
  };
}

/**
 * Restores a trashed card before its 24-hour deadline (DEL-03, DEL-04, DEL-05, DEL-06).
 * - Requires workspace owner or project manager role via acquireWriteGrantLock (members/viewers receive 403).
 * - Atomic row locking (FOR UPDATE) prevents race conditions with background purge worker.
 * - Enforces strict 24h deadline: returns 410 RESTORE_WINDOW_EXPIRED if serverNow >= restore_until.
 * - Resolves destination column: checks if original column exists, or requires valid toColumnId if missing.
 * - OCC check: expectedVersion matches card.version and expectedBoardVersion matches board.structure_version.
 * - Transitions state back to active and clears deleted_at and restore_until.
 * - Increments board structure_version and snapshot_version.
 * - Writes activity_log fact.
 * - Returns restored card.
 */
export async function restoreCard(
  client: pg.ClientBase,
  cardId: string,
  input: RestoreCardInput,
  actorId: string,
): Promise<Card> {
  const validated = parseOrThrow(restoreCardInputSchema, input);
  await lockCardBoard(client, cardId, actorId);

  // 1. Fetch card with row lock (DEL-06: serialize against concurrent purge)
  const cardRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    board_id: string;
    column_id: string;
    title: string;
    position: number | string;
    version: number;
    state: CardState;
    restore_until: Date | null;
    board_structure_version: number;
    board_snapshot_version: number;
    project_archived: boolean;
    board_archived: boolean;
  }>(
    `SELECT c.id, c.workspace_id, c.project_id, c.board_id, c.column_id, c.title, c.position, c.version, c.state,
            c.restore_until,
            b.structure_version AS board_structure_version,
            b.snapshot_version AS board_snapshot_version,
            b.archived AS board_archived,
            p.archived AS project_archived
     FROM cards c
     JOIN boards b ON c.board_id = b.id
     JOIN projects p ON c.project_id = p.id
     WHERE c.id = $1
     FOR UPDATE`,
    [cardId],
  );

  if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  const card = cardRes.rows[0];

  if (card.state === 'purged') {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }
  if (card.state !== 'trashed') {
    throw HttpError.badRequest('CARD_NOT_TRASHED', 'Card is not in trashed state.');
  }

  // 2. Authorization check: Owner or Manager only (DEL-03)
  await acquireWriteGrantLock(client, card.project_id, actorId, 'manager', card.board_id);

  // 3. Read-only context check
  if (card.project_archived) {
    throw HttpError.conflict('READ_ONLY_CONTEXT', 'Cannot restore card in an archived project.', {
      reason: 'project_archived',
      contextId: card.project_id,
    });
  }
  if (card.board_archived) {
    throw HttpError.conflict('READ_ONLY_CONTEXT', 'Cannot restore card on an archived board.', {
      reason: 'board_archived',
      contextId: card.board_id,
    });
  }

  // 4. Strict 24-hour restore deadline check (DEL-05)
  const serverNow = new Date();
  const restoreUntil = card.restore_until ? new Date(card.restore_until) : new Date(0);

  if (serverNow.getTime() >= restoreUntil.getTime()) {
    throw new HttpError(410, 'RESTORE_WINDOW_EXPIRED', 'Card restore window has expired.', {
      serverNow: serverNow.toISOString(),
      restoreUntil: restoreUntil.toISOString(),
    });
  }

  // 5. Destination column resolution (DEL-04)
  let targetColumnId: string;
  if (validated.toColumnId) {
    // Explicit toColumnId provided: verify it belongs to this board
    const colRes = await client.query<{ id: string }>(
      `SELECT id FROM columns WHERE id = $1 AND board_id = $2`,
      [validated.toColumnId, card.board_id],
    );
    if (colRes.rows.length === 0) {
      throw HttpError.badRequest(
        'INVALID_DESTINATION',
        'Explicit destination column does not exist on this board.',
      );
    }
    targetColumnId = validated.toColumnId;
  } else {
    // No toColumnId provided: verify original column still exists on this board
    const colRes = await client.query<{ id: string }>(
      `SELECT id FROM columns WHERE id = $1 AND board_id = $2`,
      [card.column_id, card.board_id],
    );
    if (colRes.rows.length === 0) {
      throw HttpError.conflict(
        'RESTORE_DESTINATION_REQUIRED',
        'Original column was deleted; explicit destination column is required.',
        {
          reason: 'destination_missing',
          boardId: card.board_id,
        },
      );
    }
    targetColumnId = card.column_id;
  }

  // 6. OCC check
  if (card.version !== validated.expectedVersion) {
    throw HttpError.conflict('STALE_VERSION', 'Card version does not match expected version.');
  }
  if (card.board_structure_version !== validated.expectedBoardVersion) {
    throw HttpError.conflict('STALE_VERSION', 'Board structure version does not match expected board version.');
  }

  // 6b. Re-anchor card position in targetColumnId (DEL-03, DEL-04, FEATURE_SPEC 8)
  const destCardsRes = await client.query<{ id: string; position: number }>(
    `SELECT id, position
     FROM cards
     WHERE column_id = $1 AND state = 'active' AND id != $2
     ORDER BY cards.position ASC, cards.id ASC
     FOR UPDATE`,
    [targetColumnId, cardId],
  );
  const destCards = destCardsRes.rows.map((r) => ({
    id: r.id,
    position: Number(r.position),
  }));
  destCards.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  // Retrieve trash metadata from activity_log if available
  const actLogRes = await client.query<{ safe_changes: any }>(
    `SELECT safe_changes
     FROM activity_log
     WHERE card_id = $1 AND action = 'card_trashed'
     ORDER BY created_at DESC
     LIMIT 1`,
    [cardId],
  );
  const safeChanges = actLogRes.rows[0]?.safe_changes;
  const prevAnchorId: string | null = safeChanges?.previousCardId ?? null;
  const nextAnchorId: string | null = safeChanges?.nextCardId ?? null;
  const originalPos: number = safeChanges?.originalPosition ?? Number(card.position);

  let newPosition: number;

  if (destCards.length === 0) {
    newPosition = 1000;
  } else {
    const prevIdx = prevAnchorId ? destCards.findIndex((c) => c.id === prevAnchorId) : -1;
    const nextIdx = nextAnchorId ? destCards.findIndex((c) => c.id === nextAnchorId) : -1;

    if (prevIdx !== -1 && nextIdx !== -1 && nextIdx === prevIdx + 1) {
      newPosition = Math.floor((destCards[prevIdx]!.position + destCards[nextIdx]!.position) / 2);
    } else if (prevIdx !== -1) {
      const prevPos = destCards[prevIdx]!.position;
      const nextCard = destCards[prevIdx + 1];
      newPosition = nextCard ? Math.floor((prevPos + nextCard.position) / 2) : prevPos + 1000;
    } else if (nextIdx !== -1) {
      const nextPos = destCards[nextIdx]!.position;
      const prevCard = destCards[nextIdx - 1];
      newPosition = prevCard ? Math.floor((prevCard.position + nextPos) / 2) : Math.max(1, Math.floor(nextPos / 2));
    } else {
      if (originalPos < destCards[0]!.position) {
        newPosition = Math.max(1, Math.floor(destCards[0]!.position / 2));
      } else if (originalPos > destCards[destCards.length - 1]!.position) {
        newPosition = destCards[destCards.length - 1]!.position + 1000;
      } else {
        let foundIdx = -1;
        for (let i = 0; i < destCards.length - 1; i++) {
          if (destCards[i]!.position <= originalPos && originalPos <= destCards[i + 1]!.position) {
            foundIdx = i;
            break;
          }
        }
        if (foundIdx !== -1) {
          newPosition = Math.floor((destCards[foundIdx]!.position + destCards[foundIdx + 1]!.position) / 2);
        } else {
          newPosition = destCards[destCards.length - 1]!.position + 1000;
        }
      }
    }

    if (destCards.some((c) => c.position === newPosition)) {
      for (let i = 0; i < destCards.length; i++) {
        await client.query('UPDATE cards SET position = $1 WHERE id = $2', [(i + 1) * 1000, destCards[i]!.id]);
      }
      newPosition = (destCards.length + 1) * 1000;
    }
  }

  const nowIso = serverNow.toISOString();

  // 7. Transition card back to active state with re-anchored position
  await client.query(
    `UPDATE cards
     SET state = 'active',
         deleted_at = NULL,
         deleted_by = NULL,
         restore_until = NULL,
         column_id = $1,
         position = $2,
         version = version + 1,
         updated_at = $3
     WHERE id = $4`,
    [targetColumnId, newPosition, nowIso, cardId],
  );

  // 8. Increment board structure_version and snapshot_version
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = $1
     WHERE id = $2`,
    [nowIso, card.board_id],
  );

  // 9. Record activity_log fact
  await recordActivity(client, {
    workspaceId: card.workspace_id,
    projectId: card.project_id,
    boardId: card.board_id,
    cardId: card.id,
    actorId,
    action: 'card_restored',
    safeChanges: { cardId: card.id, columnId: targetColumnId },
    createdAt: nowIso,
  });

  const restoredCard = await fetchCardWithCounts(client, cardId);
  if (!restoredCard) {
    throw new Error('Failed to retrieve restored card');
  }

  return restoredCard;
}
