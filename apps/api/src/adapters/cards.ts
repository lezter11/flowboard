import crypto from 'node:crypto';
import type pg from 'pg';
import {
  type Card,
  type CardSummary,
  type CreateCardInput,
  type UpdateCardInput,
  type MoveCardInput,
  type PlacementInput,
  type PlacementResult,
  type PersonDisplay,
  type Priority,
  type CardState,
  isValidGregorianDate,
  ValidationError,
} from '@flowboard/contracts';
import { HttpError, validationError } from '../http/errors.ts';
import { resolveProjectRole, acquireWriteGrantLock, acquireWritableProjectContextLock, getHistoricalPersonDisplay } from './rbac.ts';
import { getPool } from './postgres.ts';
import { getWorkspaceToday } from './boards.ts';
import { recordActivity } from './activity.ts';

export interface CardRow {
  id: string;
  workspace_id: string;
  project_id: string;
  board_id: string;
  column_id: string;
  title: string;
  description: string | null;
  priority: Priority;
  due_date: string | null;
  position: string | number;
  version: number;
  state: CardState;
  deleted_at: Date | string | null;
  deleted_by: string | null;
  restore_until: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  // Present only on queries that compute the human key (e.g. WEB-101).
  card_key?: string;
}

// Human key: the stored project prefix plus the card's global sequence number. The expression
// is a correlated subquery so it works in SELECT and in INSERT ... RETURNING.
const CARD_KEY_SQL = `(SELECT p.key_prefix FROM projects p WHERE p.id = cards.project_id) || '-' || cards.card_number::text AS card_key`;

async function requireCardBoardAccess(
  db: pg.ClientBase | pg.Pool, boardId: string, projectId: string, actorId: string,
): Promise<void> {
  const access = await db.query<{ allowed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM boards b JOIN projects p ON p.id = b.project_id
       JOIN workspaces w ON w.id = p.workspace_id
       WHERE b.id = $1 AND b.project_id = $2
         AND (w.owner_id = $3 OR EXISTS (
           SELECT 1 FROM project_memberships pm JOIN board_grants bg
             ON bg.project_id = pm.project_id AND bg.user_id = pm.user_id
           WHERE pm.project_id = p.id AND pm.user_id = $3 AND pm.status = 'active'
             AND bg.board_id = b.id))) AS allowed`,
    [boardId, projectId, actorId],
  );
  if (!access.rows[0]?.allowed) throw HttpError.notFound('Card not found.', 'NOT_FOUND');
}

export function toCard(
  row: CardRow,
  assigneeIds: string[],
  commentCount: number,
  imageCount: number,
): Card {
  return {
    id: row.id,
    ...(row.card_key ? { key: row.card_key } : {}),
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    boardId: row.board_id,
    columnId: row.column_id,
    title: row.title,
    description: row.description ?? '',
    priority: row.priority,
    dueDate: row.due_date,
    assigneeIds,
    position: Number(row.position),
    version: row.version,
    state: row.state,
    deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
    deletedBy: row.deleted_by ?? null,
    restoreUntil: row.restore_until ? new Date(row.restore_until).toISOString() : null,
    commentCount,
    imageCount,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export function toCardSummary(
  row: {
    id: string;
    board_id: string;
    column_id: string;
    title: string;
    priority: Priority;
    due_date: string | null;
    position: string | number;
    version: number;
    created_at: Date | string;
    updated_at: Date | string;
  },
  assigneeIds: string[],
  commentCount: number,
  imageCount: number,
): CardSummary {
  return {
    id: row.id,
    boardId: row.board_id,
    columnId: row.column_id,
    title: row.title,
    priority: row.priority,
    dueDate: row.due_date,
    assigneeIds,
    position: Number(row.position),
    version: row.version,
    commentCount,
    imageCount,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Validates that all assignees are active project members or the workspace owner for this project.
 * Throws 422 VALIDATION_ERROR on any invalid, outsider, removed, or sibling user ID.
 */
async function validateAssigneeIds(
  clientOrPool: pg.ClientBase | pg.Pool,
  projectId: string,
  workspaceId: string,
  boardId: string,
  assigneeIds: string[],
): Promise<void> {
  if (assigneeIds.length === 0) return;

  if (assigneeIds.length > 20) {
    throw validationError('At most 20 assignees can be assigned to a card.', {
      issues: [{ path: 'assigneeIds', message: 'At most 20 assignees can be assigned' }],
    });
  }

  const uniqueAssigneeIds = Array.from(new Set(assigneeIds));
  if (uniqueAssigneeIds.length !== assigneeIds.length) {
    throw validationError('Assignee IDs must be unique.', {
      issues: [{ path: 'assigneeIds', message: 'Assignee IDs must be unique' }],
    });
  }

  // Find all user IDs in the list that are either the workspace owner or active project members
  const validUsersRes = await clientOrPool.query<{ id: string }>(
    `SELECT u.id
     FROM users u
     WHERE u.id = ANY($1::TEXT[])
       AND (
         u.id = (SELECT owner_id FROM workspaces WHERE id = $2)
         OR EXISTS (
           SELECT 1 FROM project_memberships pm
           JOIN board_grants bg ON bg.project_id = pm.project_id
             AND bg.user_id = pm.user_id AND bg.board_id = $4
           WHERE pm.project_id = $3
             AND pm.user_id = u.id
             AND pm.status = 'active'
         )
       )`,
    [assigneeIds, workspaceId, projectId, boardId],
  );

  const validSet = new Set(validUsersRes.rows.map((r) => r.id));
  const invalidUsers = assigneeIds.filter((id) => !validSet.has(id));

  if (invalidUsers.length > 0) {
    throw validationError('All assignees must be active members of this project.', {
      issues: [
        {
          path: 'assigneeIds',
          message: `Users are not active project members: ${invalidUsers.join(', ')}`,
        },
      ],
      invalidAssigneeIds: invalidUsers,
    });
  }
}

/**
 * Fetch counts of active comments and images for a list of card IDs.
 */
async function fetchCardCounts(
  clientOrPool: pg.ClientBase | pg.Pool,
  cardIds: string[],
): Promise<{
  commentCounts: Map<string, number>;
  imageCounts: Map<string, number>;
  assigneesMap: Map<string, string[]>;
}> {
  const commentCounts = new Map<string, number>();
  const imageCounts = new Map<string, number>();
  const assigneesMap = new Map<string, string[]>();

  if (cardIds.length === 0) {
    return { commentCounts, imageCounts, assigneesMap };
  }

  const commentsRes = await clientOrPool.query<{ card_id: string; count: string }>(
    `SELECT card_id, COUNT(*)::TEXT AS count
     FROM comments
     WHERE card_id = ANY($1::TEXT[]) AND deleted_at IS NULL
     GROUP BY card_id`,
    [cardIds],
  );

  const imagesRes = await clientOrPool.query<{ card_id: string; count: string }>(
    `SELECT card_id, COUNT(*)::TEXT AS count
     FROM card_images
     WHERE card_id = ANY($1::TEXT[])
     GROUP BY card_id`,
    [cardIds],
  );

  const assigneesRes = await clientOrPool.query<{ card_id: string; user_id: string }>(
    `SELECT card_id, user_id
     FROM card_assignees
     WHERE card_id = ANY($1::TEXT[])
     ORDER BY created_at ASC`,
    [cardIds],
  );

  for (const row of commentsRes.rows) {
    commentCounts.set(row.card_id, parseInt(row.count, 10));
  }
  for (const row of imagesRes.rows) {
    imageCounts.set(row.card_id, parseInt(row.count, 10));
  }
  for (const row of assigneesRes.rows) {
    const list = assigneesMap.get(row.card_id) ?? [];
    list.push(row.user_id);
    assigneesMap.set(row.card_id, list);
  }

  return { commentCounts, imageCounts, assigneesMap };
}

export interface CreateCardAdapterInput {
  title: string;
  columnId: string;
  description?: string | undefined;
  priority?: Priority | undefined;
  dueDate?: string | null | undefined;
  assigneeIds?: string[] | undefined;
  expectedBoardVersion: number;
}

/**
 * CRD-01: Quick creation of a card in an authorized board column.
 */
export async function createCard(
  client: pg.ClientBase,
  boardId: string,
  input: CreateCardAdapterInput,
  actorId: string,
): Promise<Card> {
  const accessBoard = await client.query<{ project_id: string }>(
    'SELECT project_id FROM boards WHERE id = $1', [boardId],
  );
  if (!accessBoard.rows[0]) throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  await acquireWriteGrantLock(client, accessBoard.rows[0].project_id, actorId, 'member', boardId);
  await acquireWritableProjectContextLock(client, accessBoard.rows[0].project_id, boardId);
  // 1. Lock and fetch board
  const boardRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    structure_version: number;
    snapshot_version: number;
    archived: boolean;
  }>(
    `SELECT id, workspace_id, project_id, structure_version, snapshot_version, archived
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [boardId],
  );

  if (boardRes.rows.length === 0) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }

  const board = boardRes.rows[0]!;

  // 2. Role permission check: Owner, manager, or member required via write grant lock

  // 3. Board structure version OCC check
  if (board.structure_version !== input.expectedBoardVersion) {
    throw HttpError.conflict('STALE_BOARD_VERSION', 'Stale board structure version.', {
      currentBoardVersion: board.structure_version,
      expectedBoardVersion: input.expectedBoardVersion,
    });
  }

  // 4. Validate target column belongs to this board
  const columnRes = await client.query<{ id: string; workspace_id: string; project_id: string }>(
    `SELECT id, workspace_id, project_id
     FROM columns
     WHERE id = $1 AND board_id = $2`,
    [input.columnId, boardId],
  );

  if (columnRes.rows.length === 0) {
    throw validationError('Target column not found on this board.', {
      issues: [{ path: 'columnId', message: 'Target column not found on this board' }],
    });
  }

  // 5. Title validation (trimmed 1-200 chars)
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length < 1 || trimmedTitle.length > 200) {
    throw validationError('Title must be between 1 and 200 characters.', {
      issues: [{ path: 'title', message: 'Title must be between 1 and 200 characters' }],
    });
  }

  // 6. Gregorian date validation if provided
  if (input.dueDate !== null && input.dueDate !== undefined) {
    if (!isValidGregorianDate(input.dueDate)) {
      throw validationError('Due date must be a valid Gregorian calendar date in YYYY-MM-DD format.', {
        issues: [{ path: 'dueDate', message: 'Invalid calendar date' }],
      });
    }
  }

  // 7. Validate assignees
  const assigneeIds = input.assigneeIds ?? [];
  await validateAssigneeIds(client, board.project_id, board.workspace_id, boardId, assigneeIds);

  // 8. Position rank allocation: position = (max(position) in column for active cards || 0) + 1000
  const posRes = await client.query<{ max_pos: string | null }>(
    `SELECT COALESCE(MAX(position), 0)::TEXT AS max_pos
     FROM cards
     WHERE column_id = $1 AND state = 'active'`,
    [input.columnId],
  );
  const maxPos = parseInt(posRes.rows[0]?.max_pos ?? '0', 10);
  const position = maxPos + 1000;

  // 9. Generate card ID and insert atomically into cards
  const cardId = 'crd_' + crypto.randomUUID();
  const description = input.description ?? '';
  const priority = input.priority ?? 'none';
  const dueDate = input.dueDate ?? null;

  const insertCardRes = await client.query<CardRow>(
    `INSERT INTO cards (
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, due_date, position,
       version, state, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       1, 'active', NOW(), NOW()
     )
     RETURNING 
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, position,
       version, state, deleted_at, deleted_by, restore_until,
       created_at, updated_at,
       ${CARD_KEY_SQL}`,
    [
      cardId,
      board.workspace_id,
      board.project_id,
      boardId,
      input.columnId,
      trimmedTitle,
      description,
      priority,
      dueDate,
      position,
    ],
  );

  const cardRow = insertCardRes.rows[0]!;

  // 10. Insert assignees into card_assignees
  for (const uid of assigneeIds) {
    await client.query(
      `INSERT INTO card_assignees (card_id, user_id, workspace_id, project_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [cardId, uid, board.workspace_id, board.project_id],
    );
  }

  // 11. Atomically increment board structure_version and snapshot_version
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [boardId],
  );

  // 12. Record activity log fact (AUD-01, AUD-02)
  await recordActivity(client, {
    workspaceId: board.workspace_id,
    projectId: board.project_id,
    boardId,
    cardId,
    actorId,
    action: 'card_created',
    safeChanges: {
      title: trimmedTitle,
      columnId: input.columnId,
      priority,
      dueDate,
      assigneeIds,
    },
  });

  return toCard(cardRow, assigneeIds, 0, 0);
}

/**
 * CRD-03: Retrieve full card entity and referenced PersonDisplay identities.
 */
export async function getCard(
  poolOrClient: pg.Pool | pg.ClientBase,
  cardId: string,
  actorId: string,
): Promise<{ card: Card; people: PersonDisplay[] }> {
  // 1. Fetch active card
  const cardRes = await poolOrClient.query<CardRow>(
    `SELECT 
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, position,
       version, state, deleted_at, deleted_by, restore_until,
       created_at, updated_at,
       ${CARD_KEY_SQL}
     FROM cards
     WHERE id = $1`,
    [cardId],
  );

  if (cardRes.rows.length === 0) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  const cardRow = cardRes.rows[0]!;

  // Trashed or purged cards return 404 to normal readers
  if (cardRow.state !== 'active') {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  // 2. Independent authorization: project membership verification
  const role = await resolveProjectRole(cardRow.project_id, actorId, poolOrClient);
  if (!role) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  await requireCardBoardAccess(poolOrClient, cardRow.board_id, cardRow.project_id, actorId);

  // 3. Fetch counts and assignees
  const { commentCounts, imageCounts, assigneesMap } = await fetchCardCounts(poolOrClient, [cardId]);
  const assigneeIds = assigneesMap.get(cardId) ?? [];
  const commentCount = commentCounts.get(cardId) ?? 0;
  const imageCount = imageCounts.get(cardId) ?? 0;

  // 4. Fetch PersonDisplay for referenced assignees
  const people: PersonDisplay[] = [];
  for (const uid of assigneeIds) {
    const p = await getHistoricalPersonDisplay(poolOrClient, cardRow.project_id, uid);
    if (p) {
      people.push(p);
    }
  }

  await requireCardBoardAccess(poolOrClient, cardRow.board_id, cardRow.project_id, actorId);

  const card = toCard(cardRow, assigneeIds, commentCount, imageCount);
  const createdBy = await getCardCreator(poolOrClient, cardRow.id, cardRow.workspace_id, cardRow.project_id);

  return {
    card: createdBy === undefined ? card : { ...card, createdBy },
    people,
  };
}

/**
 * Who created a card, from its card_created activity fact. Returns null for cards with no such
 * fact (created before activity recording). activeInProject is true for the workspace owner or an
 * active project member. The caller has already passed the board-access check.
 */
async function getCardCreator(
  db: pg.ClientBase | pg.Pool,
  cardId: string,
  workspaceId: string,
  projectId: string,
): Promise<{
  id: string;
  displayName: string;
  avatarUrl: string | null;
  activeInProject: boolean;
} | null> {
  const res = await db.query<{ id: string; display_name: string; avatar_url: string | null; active: boolean }>(
    `SELECT u.id, u.display_name, u.avatar_url,
       (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = $2 AND w.owner_id = u.id)
        OR EXISTS (SELECT 1 FROM project_memberships pm
                   WHERE pm.project_id = $3 AND pm.user_id = u.id AND pm.status = 'active')) AS active
     FROM activity_log al
     JOIN users u ON u.id = al.actor_id
     WHERE al.card_id = $1 AND al.action = 'card_created'
     ORDER BY al.created_at ASC, al.id ASC
     LIMIT 1`,
    [cardId, workspaceId, projectId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, displayName: row.display_name, avatarUrl: row.avatar_url, activeInProject: Boolean(row.active) };
}

/**
 * CRD-04, CRD-05, CRD-06: Edit card title, description, priority, dueDate, and assignees with OCC check.
 */
export async function updateCard(
  client: pg.ClientBase,
  cardId: string,
  input: UpdateCardInput,
  actorId: string,
): Promise<Card> {
  const accessCard = await client.query<{ project_id: string; board_id: string }>(
    'SELECT project_id, board_id FROM cards WHERE id = $1', [cardId],
  );
  if (!accessCard.rows[0]) throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  await acquireWriteGrantLock(client, accessCard.rows[0].project_id, actorId, 'member', accessCard.rows[0].board_id);
  await acquireWritableProjectContextLock(client, accessCard.rows[0].project_id, accessCard.rows[0].board_id);
  // 1. Lock and fetch active card
  const cardRes = await client.query<CardRow>(
    `SELECT 
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, position,
       version, state, deleted_at, deleted_by, restore_until,
       created_at, updated_at
     FROM cards
     WHERE id = $1
     FOR UPDATE`,
    [cardId],
  );

  if (cardRes.rows.length === 0) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  const card = cardRes.rows[0]!;
  if (card.state !== 'active') {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  // 2. Role check via write grant lock

  // 3. OCC version check
  if (card.version !== input.expectedVersion) {
    throw HttpError.conflict('STALE_VERSION', 'Stale card version.', {
      currentVersion: card.version,
      expectedVersion: input.expectedVersion,
    });
  }

  // 4. Validate fields
  let nextTitle = card.title;
  if (input.title !== undefined) {
    const trimmed = input.title.trim();
    if (trimmed.length < 1 || trimmed.length > 200) {
      throw validationError('Title must be between 1 and 200 characters.', {
        issues: [{ path: 'title', message: 'Title must be between 1 and 200 characters' }],
      });
    }
    nextTitle = trimmed;
  }

  let nextDescription = card.description ?? '';
  if (input.description !== undefined) {
    nextDescription = input.description ?? '';
    if (nextDescription.length > 20000) {
      throw validationError('Description cannot exceed 20,000 characters.', {
        issues: [{ path: 'description', message: 'Description cannot exceed 20,000 characters' }],
      });
    }
  }

  const nextPriority = input.priority !== undefined ? input.priority : card.priority;

  let nextDueDate = card.due_date;
  if (input.dueDate !== undefined) {
    if (input.dueDate !== null && !isValidGregorianDate(input.dueDate)) {
      throw validationError('Due date must be a valid Gregorian calendar date in YYYY-MM-DD format.', {
        issues: [{ path: 'dueDate', message: 'Invalid calendar date' }],
      });
    }
    nextDueDate = input.dueDate;
  }

  // 5. Validate and sync assignees if provided
  const changes: Record<string, { old?: unknown; new?: unknown; added?: string[]; removed?: string[] }> = {};
  let nextAssigneeIds: string[];
  if (input.assigneeIds !== undefined) {
    await validateAssigneeIds(client, card.project_id, card.workspace_id, card.board_id, input.assigneeIds);
    nextAssigneeIds = input.assigneeIds;

    let oldAssigneeIds: string[] = [];
    const currentAssignees = await client.query<{ user_id: string }>(
      'SELECT user_id FROM card_assignees WHERE card_id = $1 ORDER BY created_at ASC',
      [cardId],
    );
    oldAssigneeIds = currentAssignees.rows.map((r) => r.user_id);

    // Delete existing assignees and re-insert
    await client.query('DELETE FROM card_assignees WHERE card_id = $1', [cardId]);
    for (const uid of nextAssigneeIds) {
      await client.query(
        `INSERT INTO card_assignees (card_id, user_id, workspace_id, project_id, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [cardId, uid, card.workspace_id, card.project_id],
      );
    }

    const sortedOld = [...oldAssigneeIds].sort();
    const sortedNew = [...nextAssigneeIds].sort();
    if (sortedOld.length !== sortedNew.length || sortedOld.some((val, idx) => val !== sortedNew[idx])) {
      const added = nextAssigneeIds.filter((id) => !oldAssigneeIds.includes(id));
      const removed = oldAssigneeIds.filter((id) => !nextAssigneeIds.includes(id));
      changes.assignees = { added, removed };
    }
  } else {
    const currentAssignees = await client.query<{ user_id: string }>(
      'SELECT user_id FROM card_assignees WHERE card_id = $1 ORDER BY created_at ASC',
      [cardId],
    );
    nextAssigneeIds = currentAssignees.rows.map((r) => r.user_id);
  }

  if (input.title !== undefined && nextTitle !== card.title) {
    changes.title = { old: card.title, new: nextTitle };
  }
  if (input.description !== undefined && nextDescription !== (card.description ?? '')) {
    changes.description = { old: card.description ?? '', new: nextDescription };
  }
  if (input.priority !== undefined && nextPriority !== card.priority) {
    changes.priority = { old: card.priority, new: nextPriority };
  }
  if (input.dueDate !== undefined && nextDueDate !== card.due_date) {
    changes.dueDate = { old: card.due_date, new: nextDueDate };
  }

  // 6. Update card row
  const updateRes = await client.query<CardRow>(
    `UPDATE cards
     SET title = $1,
         description = $2,
         priority = $3,
         due_date = $4,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $5
     RETURNING 
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, position,
       version, state, deleted_at, deleted_by, restore_until,
       created_at, updated_at`,
    [nextTitle, nextDescription, nextPriority, nextDueDate, cardId],
  );

  // 7. Increment board snapshot_version
  await client.query(
    `UPDATE boards
     SET snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [card.board_id],
  );

  // 8. Record activity log fact (AUD-01, AUD-02)
  if (Object.keys(changes).length > 0) {
    await recordActivity(client, {
      workspaceId: card.workspace_id,
      projectId: card.project_id,
      boardId: card.board_id,
      cardId,
      actorId,
      action: 'card_updated',
      safeChanges: changes,
    });
  }

  const { commentCounts, imageCounts } = await fetchCardCounts(client, [cardId]);
  return toCard(
    updateRes.rows[0]!,
    nextAssigneeIds,
    commentCounts.get(cardId) ?? 0,
    imageCounts.get(cardId) ?? 0,
  );
}

/**
 * Recompact positions in a column with spacing of 1000.
 */
async function recompactColumnPositions(
  client: pg.ClientBase,
  columnId: string,
  excludedCardId?: string,
): Promise<void> {
  const cardsRes = await client.query<{ id: string }>(
    `SELECT id
     FROM cards
     WHERE column_id = $1 AND state = 'active' AND ($2::TEXT IS NULL OR id != $2)
     ORDER BY cards.position ASC, cards.id ASC
     FOR UPDATE`,
    [columnId, excludedCardId ?? null],
  );

  for (let i = 0; i < cardsRes.rows.length; i++) {
    const cId = cardsRes.rows[i]!.id;
    const newPos = (i + 1) * 1000;
    await client.query('UPDATE cards SET position = $1 WHERE id = $2', [newPos, cId]);
  }
}

/**
 * CRD-07, CRD-10: Move card across or within columns with neighbor rank calculation and dual OCC checks.
 */
export async function moveCard(
  client: pg.ClientBase,
  cardId: string,
  input: MoveCardInput,
  actorId: string,
): Promise<Card> {
  const accessCard = await client.query<{ project_id: string; board_id: string }>(
    'SELECT project_id, board_id FROM cards WHERE id = $1', [cardId],
  );
  if (!accessCard.rows[0]) throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  await acquireWriteGrantLock(client, accessCard.rows[0].project_id, actorId, 'member', accessCard.rows[0].board_id);
  await acquireWritableProjectContextLock(client, accessCard.rows[0].project_id, accessCard.rows[0].board_id);
  // 1. Lock and fetch active card
  const cardRes = await client.query<CardRow>(
    `SELECT 
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, position,
       version, state, deleted_at, deleted_by, restore_until,
       created_at, updated_at
     FROM cards
     WHERE id = $1
     FOR UPDATE`,
    [cardId],
  );

  if (cardRes.rows.length === 0) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  const card = cardRes.rows[0]!;
  if (card.state !== 'active') {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  // 2. Lock and fetch board
  const boardRes = await client.query<{
    id: string;
    structure_version: number;
    snapshot_version: number;
  }>(
    `SELECT id, structure_version, snapshot_version
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [card.board_id],
  );

  if (boardRes.rows.length === 0) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }

  const board = boardRes.rows[0]!;

  // 3. Authorization check via write grant lock

  // 4. OCC check 1: Card version
  if (card.version !== input.expectedVersion) {
    throw HttpError.conflict('STALE_VERSION', 'Stale card version.', {
      currentVersion: card.version,
      expectedVersion: input.expectedVersion,
    });
  }

  // 5. OCC check 2: Board structure version
  if (board.structure_version !== input.expectedBoardVersion) {
    throw HttpError.conflict('STALE_BOARD_VERSION', 'Stale board structure version.', {
      currentBoardVersion: board.structure_version,
      expectedBoardVersion: input.expectedBoardVersion,
    });
  }

  // 6. Verify destination column belongs to the same board
  const colRes = await client.query<{ id: string; board_id: string }>(
    `SELECT id, board_id FROM columns WHERE id = $1 AND board_id = $2`,
    [input.toColumnId, card.board_id],
  );

  if (colRes.rows.length === 0) {
    throw validationError('Destination column not found on this board.', {
      issues: [{ path: 'toColumnId', message: 'Destination column not found on this board' }],
    });
  }

  // 7. Calculate new position rank
  let calculatedPosition: number;

  // Fetch all other active cards in destination column (locked FOR UPDATE to serialize positions)
  const destCardsRes = await client.query<{ id: string; position: number }>(
    `SELECT id, position
     FROM cards
     WHERE column_id = $1 AND state = 'active' AND id != $2
     ORDER BY cards.position ASC, cards.id ASC
     FOR UPDATE`,
    [input.toColumnId, cardId],
  );
  const destCards = destCardsRes.rows.map((r) => ({
    id: r.id,
    position: Number(r.position),
  }));
  destCards.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  if (destCards.length === 0) {
    // Column is currently empty (excluding moving card)
    if (input.previousCardId !== null || input.nextCardId !== null) {
      throw validationError('Destination column is empty; both previousCardId and nextCardId must be null.', {
        issues: [{ path: 'previousCardId', message: 'Destination column is empty; neighbors must be null' }],
      });
    }
    calculatedPosition = 1000;
  } else if (input.previousCardId === null && input.nextCardId !== null) {
    // Insert at top before nextCard: nextCardId MUST be the first card in destination column!
    if (destCards[0]!.id !== input.nextCardId) {
      throw validationError('nextCardId is not the first card in destination column.', {
        issues: [{ path: 'nextCardId', message: 'nextCardId must be the first card when previousCardId is null' }],
      });
    }
    let nextPos = destCards[0]!.position;
    if (nextPos <= 1) {
      await recompactColumnPositions(client, input.toColumnId, cardId);
      const rechecked = await client.query<{ position: string }>(
        `SELECT position::TEXT FROM cards WHERE id = $1`,
        [input.nextCardId],
      );
      nextPos = parseInt(rechecked.rows[0]!.position, 10);
    }
    calculatedPosition = Math.max(1, Math.floor(nextPos / 2));
    if (calculatedPosition === nextPos) {
      await recompactColumnPositions(client, input.toColumnId, cardId);
      const rechecked = await client.query<{ position: string }>(
        `SELECT position::TEXT FROM cards WHERE id = $1`,
        [input.nextCardId],
      );
      nextPos = parseInt(rechecked.rows[0]!.position, 10);
      calculatedPosition = Math.max(1, Math.floor(nextPos / 2));
    }
  } else if (input.previousCardId !== null && input.nextCardId === null) {
    // Insert at bottom after previousCard: previousCardId MUST be the last card in destination column!
    if (destCards[destCards.length - 1]!.id !== input.previousCardId) {
      throw validationError('previousCardId is not the last card in destination column.', {
        issues: [{ path: 'previousCardId', message: 'previousCardId must be the last card when nextCardId is null' }],
      });
    }
    const prevPos = destCards[destCards.length - 1]!.position;
    calculatedPosition = prevPos + 1000;
  } else if (input.previousCardId !== null && input.nextCardId !== null) {
    // Both previousCardId and nextCardId provided: they MUST be strictly adjacent!
    const prevIdx = destCards.findIndex((c) => c.id === input.previousCardId);
    const nextIdx = destCards.findIndex((c) => c.id === input.nextCardId);

    if (prevIdx === -1) {
      throw validationError('Previous card not found in destination column.', {
        issues: [{ path: 'previousCardId', message: 'Previous card not found in destination column' }],
      });
    }
    if (nextIdx === -1) {
      throw validationError('Next card not found in destination column.', {
        issues: [{ path: 'nextCardId', message: 'Next card not found in destination column' }],
      });
    }
    if (nextIdx !== prevIdx + 1) {
      throw validationError('Supplied neighbors are not adjacent in destination column.', {
        issues: [
          {
            path: 'nextCardId',
            message: 'previousCardId and nextCardId must be consecutive cards with no intervening cards',
          },
        ],
      });
    }

    let prevPos = destCards[prevIdx]!.position;
    let nextPos = destCards[nextIdx]!.position;
    let gap = nextPos - prevPos;

    if (gap <= 1) {
      await recompactColumnPositions(client, input.toColumnId, cardId);
      const prevRechecked = await client.query<{ position: string }>(
        `SELECT position::TEXT FROM cards WHERE id = $1`,
        [input.previousCardId],
      );
      const nextRechecked = await client.query<{ position: string }>(
        `SELECT position::TEXT FROM cards WHERE id = $1`,
        [input.nextCardId],
      );
      prevPos = parseInt(prevRechecked.rows[0]!.position, 10);
      nextPos = parseInt(nextRechecked.rows[0]!.position, 10);
      gap = nextPos - prevPos;
    }

    calculatedPosition = Math.floor((prevPos + nextPos) / 2);
    if (calculatedPosition === prevPos || calculatedPosition === nextPos) {
      await recompactColumnPositions(client, input.toColumnId, cardId);
      const prevRechecked = await client.query<{ position: string }>(
        `SELECT position::TEXT FROM cards WHERE id = $1`,
        [input.previousCardId],
      );
      const nextRechecked = await client.query<{ position: string }>(
        `SELECT position::TEXT FROM cards WHERE id = $1`,
        [input.nextCardId],
      );
      prevPos = parseInt(prevRechecked.rows[0]!.position, 10);
      nextPos = parseInt(nextRechecked.rows[0]!.position, 10);
      calculatedPosition = Math.floor((prevPos + nextPos) / 2);
    }
  } else {
    // Both null on non-empty column
    throw validationError('Cannot move with both null neighbors into non-empty column.', {
      issues: [{ path: 'previousCardId', message: 'Neighbors cannot both be null in non-empty column' }],
    });
  }

  // 8. Update card column_id, position, and increment version
  const updateRes = await client.query<CardRow>(
    `UPDATE cards
     SET column_id = $1,
         position = $2,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $3
     RETURNING 
       id, workspace_id, project_id, board_id, column_id,
       title, description, priority, to_char(due_date, 'YYYY-MM-DD') AS due_date, position,
       version, state, deleted_at, deleted_by, restore_until,
       created_at, updated_at`,
    [input.toColumnId, calculatedPosition, cardId],
  );

  // 9. Atomically increment board structure_version and snapshot_version
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [card.board_id],
  );

  // 10. Record activity log fact (AUD-01, AUD-02)
  const columnTitleRes = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM columns WHERE id IN ($1, $2)`,
    [card.column_id, input.toColumnId],
  );
  const colMap = new Map(columnTitleRes.rows.map((r) => [r.id, r.name]));
  const moveChanges = {
    fromColumnId: card.column_id,
    toColumnId: input.toColumnId,
    fromColumnTitle: colMap.get(card.column_id) ?? null,
    toColumnTitle: colMap.get(input.toColumnId) ?? null,
    fromPosition: Number(card.position),
    toPosition: Number(calculatedPosition),
  };
  await recordActivity(client, {
    workspaceId: card.workspace_id,
    projectId: card.project_id,
    boardId: card.board_id,
    cardId,
    actorId,
    action: 'card_moved',
    safeChanges: moveChanges,
  });

  const { commentCounts, imageCounts, assigneesMap } = await fetchCardCounts(client, [cardId]);
  return toCard(
    updateRes.rows[0]!,
    assigneesMap.get(cardId) ?? [],
    commentCounts.get(cardId) ?? 0,
    imageCounts.get(cardId) ?? 0,
  );
}

// CRD-08, CRD-09: Delegate to canonical board placement and card listing
export { getPlacement, listBoardCards as getBoardCards } from './boards.ts';

/**
 * Search active cards across a project (project-scoped discovery).
 */
export async function searchProjectCards(
  poolOrClient: pg.Pool | pg.ClientBase,
  projectId: string,
  query: {
    query?: string | undefined;
    titleQuery?: string | undefined;
    priority?: Priority | undefined;
    assigneeId?: string | undefined;
    columnId?: string | undefined;
    due?: 'overdue' | 'today' | 'upcoming' | 'none' | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  },
  actorId: string,
  authorizedBoardIds?: string[] | null,
): Promise<{ data: CardSummary[]; nextCursor: string | null; activeCardCount: number; matchingCardCount: number }> {
  // 1. Authorize: Project-only access and fetch workspace timezone
  const projRes = await poolOrClient.query<{ id: string; archived: boolean; timezone: string }>(
    `SELECT p.id, p.archived, w.timezone
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     WHERE p.id = $1`,
    [projectId],
  );

  if (projRes.rows.length === 0 || projRes.rows[0]!.archived) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }

  const role = await resolveProjectRole(projectId, actorId, poolOrClient);
  if (!role) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }

  const timezone = projRes.rows[0]?.timezone ?? 'UTC';
  const asOfDate = getWorkspaceToday(timezone);
  const visibleBoards = await poolOrClient.query<{
    id: string; snapshot_version: number; access_revision: string;
  }>(
    `SELECT b.id, b.snapshot_version, b.access_revision::text FROM boards b
     JOIN projects p ON p.id = b.project_id JOIN workspaces w ON w.id = p.workspace_id
     WHERE b.project_id = $1 AND (w.owner_id = $2 OR EXISTS (
       SELECT 1 FROM project_memberships pm JOIN board_grants bg
         ON bg.project_id = pm.project_id AND bg.user_id = pm.user_id
       WHERE pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
         AND bg.board_id = b.id))
       ${authorizedBoardIds ? 'AND b.id = ANY($3::text[])' : ''}
     ORDER BY b.id`,
    authorizedBoardIds ? [projectId, actorId, authorizedBoardIds] : [projectId, actorId],
  );
  const filterHash = crypto.createHash('sha256').update(JSON.stringify([
    projectId, actorId, query.titleQuery ?? query.query ?? '', query.priority ?? '',
    query.assigneeId ?? '', query.columnId ?? '', query.due ?? '', asOfDate,
    visibleBoards.rows.map((board) => [board.id, board.snapshot_version, board.access_revision]),
  ])).digest('hex');

  const visible = `(w.owner_id = $2 OR EXISTS (
    SELECT 1 FROM project_memberships pm JOIN board_grants bg
      ON bg.project_id = pm.project_id AND bg.user_id = pm.user_id
    WHERE pm.project_id = c.project_id AND pm.user_id = $2
      AND pm.status = 'active' AND bg.board_id = c.board_id))`;
  const conditions: string[] = [`c.project_id = $1`, `c.state = 'active'`, visible];
  const params: unknown[] = [projectId, actorId];
  if (authorizedBoardIds) {
    conditions.push('c.board_id = ANY($3::text[])');
    params.push(authorizedBoardIds);
  }
  let pIdx = params.length + 1;

  const searchQuery = query.titleQuery ?? query.query;
  if (searchQuery) {
    conditions.push(`(c.title ILIKE $${pIdx} OR c.description ILIKE $${pIdx})`);
    pIdx++;
    params.push(`%${searchQuery}%`);
  }

  if (query.priority) {
    conditions.push(`c.priority = $${pIdx++}`);
    params.push(query.priority);
  }

  if (query.columnId) {
    conditions.push(`c.column_id = $${pIdx++}`);
    params.push(query.columnId);
  }

  if (query.assigneeId) {
    conditions.push(
      `EXISTS (SELECT 1 FROM card_assignees ca WHERE ca.card_id = c.id AND ca.user_id = $${pIdx++})`,
    );
    params.push(query.assigneeId);
  }

  if (query.due) {
    if (query.due === 'overdue') {
      // Overdue: due_date < workspace today AND column category is NOT 'done' (F-03)
      conditions.push(`c.due_date IS NOT NULL AND c.due_date < $${pIdx++}::date AND col.category != 'done'`);
      params.push(asOfDate);
    } else if (query.due === 'today') {
      conditions.push(`c.due_date = $${pIdx++}::date`);
      params.push(asOfDate);
    } else if (query.due === 'upcoming') {
      conditions.push(`c.due_date > $${pIdx++}::date`);
      params.push(asOfDate);
    } else if (query.due === 'none') {
      conditions.push(`c.due_date IS NULL`);
    }
  }

  // Active vs matching counts
  const countParams = [...params];
  const countSql = `
    SELECT 
      (SELECT COUNT(*)::INT FROM cards counted
       JOIN projects cp ON cp.id = counted.project_id
       JOIN workspaces cw ON cw.id = cp.workspace_id
       WHERE counted.project_id = $1 AND counted.state = 'active'
         AND (cw.owner_id = $2 OR EXISTS (
           SELECT 1 FROM project_memberships pm JOIN board_grants bg
             ON bg.project_id = pm.project_id AND bg.user_id = pm.user_id
           WHERE pm.project_id = counted.project_id AND pm.user_id = $2
             AND pm.status = 'active' AND bg.board_id = counted.board_id))
         ${authorizedBoardIds ? 'AND counted.board_id = ANY($3::text[])' : ''}) AS active_count,
      COUNT(*)::INT AS matching_count
    FROM cards c
    JOIN columns col ON col.id = c.column_id
    JOIN projects p ON p.id = c.project_id
    JOIN workspaces w ON w.id = p.workspace_id
    WHERE ${conditions.join(' AND ')}
  `;
  const countRes = await poolOrClient.query<{ active_count: number; matching_count: number }>(countSql, countParams);
  const activeCardCount = countRes.rows[0]?.active_count ?? 0;
  const matchingCardCount = countRes.rows[0]?.matching_count ?? 0;

  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  if (query.cursor) {
    let cursor: unknown;
    try { cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')); } catch { /* invalid */ }
    const parsed = cursor as { hash?: unknown; position?: unknown; id?: unknown } | undefined;
    if (!parsed || parsed.hash !== filterHash || typeof parsed.position !== 'string' ||
        !/^-?\d+(?:\.\d+)?$/.test(parsed.position) || typeof parsed.id !== 'string') {
      throw HttpError.conflict('Stale or malformed pagination cursor.', 'STALE_CURSOR');
    }
    conditions.push(`(c.position > $${pIdx}::numeric OR (c.position = $${pIdx}::numeric AND c.id > $${pIdx + 1}))`);
    params.push(parsed.position, parsed.id);
    pIdx += 2;
  }
  params.push(limit + 1);

  const sql = `
    SELECT 
      c.id, c.board_id, c.column_id, c.title, c.priority,
      to_char(c.due_date, 'YYYY-MM-DD') AS due_date, c.position::TEXT,
      c.version, c.created_at, c.updated_at
    FROM cards c
    JOIN columns col ON col.id = c.column_id
    JOIN projects p ON p.id = c.project_id
    JOIN workspaces w ON w.id = p.workspace_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.position ASC, c.id ASC
    LIMIT $${pIdx}
  `;

  const res = await poolOrClient.query<{
    id: string;
    board_id: string;
    column_id: string;
    title: string;
    priority: Priority;
    due_date: string | null;
    position: string;
    version: number;
    created_at: Date;
    updated_at: Date;
  }>(sql, params);

  const page = res.rows.slice(0, limit);
  const cardIds = page.map((r) => r.id);
  const { commentCounts, imageCounts, assigneesMap } = await fetchCardCounts(poolOrClient, cardIds);

  const summaries = page.map((r) =>
    toCardSummary(
      r,
      assigneesMap.get(r.id) ?? [],
      commentCounts.get(r.id) ?? 0,
      imageCounts.get(r.id) ?? 0,
    ),
  );

  if (!await resolveProjectRole(projectId, actorId, poolOrClient)) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }
  for (const boardId of new Set(page.map((row) => row.board_id))) {
    await requireCardBoardAccess(poolOrClient, boardId, projectId, actorId);
  }

  const last = page.at(-1);
  const nextCursor = res.rows.length > limit && last
    ? Buffer.from(JSON.stringify({ hash: filterHash, position: last.position, id: last.id })).toString('base64url')
    : null;
  return { data: summaries, nextCursor, activeCardCount, matchingCardCount };
}

/**
 * QRY-03: Retrieve actor assignments within one selected project.
 */
export async function getMyTasks(
  poolOrClient: pg.Pool | pg.ClientBase,
  actorId: string,
  options: { projectId: string; limit?: number | undefined; workspaceId?: string | undefined; authorizedBoardIds?: string[] | null },
): Promise<{ data: (CardSummary & { projectName?: string; boardName?: string; columnTitle?: string })[] }> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);

  const conditions = [
    `c.state = 'active'`,
    `ca.user_id = $1`,
    `c.project_id = $2`,
    `(w.owner_id = $1 OR pm.id IS NOT NULL)`,
    `(w.owner_id = $1 OR EXISTS (
       SELECT 1 FROM board_grants bg WHERE bg.board_id = c.board_id
         AND bg.project_id = c.project_id AND bg.user_id = $1))`,
  ];
  const params: unknown[] = [actorId, options.projectId];
  let pIdx = 3;

  if (options.authorizedBoardIds) {
    conditions.push(`c.board_id = ANY($${pIdx++}::text[])`);
    params.push(options.authorizedBoardIds);
  }

  if (options?.workspaceId) {
    conditions.push(`w.id = $${pIdx++}`);
    params.push(options.workspaceId);
  }

  params.push(limit);

  const res = await poolOrClient.query<{
    id: string;
    board_id: string;
    column_id: string;
    title: string;
    priority: Priority;
    due_date: string | null;
    position: string;
    version: number;
    created_at: Date;
    updated_at: Date;
    project_name: string;
    board_name: string;
    column_title: string;
  }>(
    `SELECT 
       c.id, c.board_id, c.column_id, c.title, c.priority,
       to_char(c.due_date, 'YYYY-MM-DD') AS due_date, c.position::TEXT,
       c.version, c.created_at, c.updated_at,
       p.name AS project_name, b.name AS board_name, col.name AS column_title
     FROM cards c
     JOIN card_assignees ca ON ca.card_id = c.id
     JOIN projects p ON c.project_id = p.id
     JOIN boards b ON c.board_id = b.id
     JOIN columns col ON c.column_id = col.id
     JOIN workspaces w ON p.workspace_id = w.id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'active'
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.due_date ASC NULLS LAST, c.updated_at DESC
     LIMIT $${pIdx}`,
    params,
  );

  const cardIds = res.rows.map((r) => r.id);
  const { commentCounts, imageCounts, assigneesMap } = await fetchCardCounts(poolOrClient, cardIds);

  const summaries = res.rows.map((r) => ({
    ...toCardSummary(
      r,
      assigneesMap.get(r.id) ?? [],
      commentCounts.get(r.id) ?? 0,
      imageCounts.get(r.id) ?? 0,
    ),
    projectName: r.project_name,
    boardName: r.board_name,
    columnTitle: r.column_title,
  }));

  // The list query filters before its LIMIT. Recheck every returned board so a
  // grant removed during enrichment cannot disclose card or count metadata.
  for (const boardId of new Set(res.rows.map((row) => row.board_id))) {
    const allowed = await poolOrClient.query<{ allowed: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM boards b JOIN projects p ON p.id = b.project_id
         JOIN workspaces w ON w.id = p.workspace_id
         WHERE b.id = $1 AND (w.owner_id = $2 OR EXISTS (
           SELECT 1 FROM project_memberships pm JOIN board_grants bg
             ON bg.project_id = p.id AND bg.board_id = b.id AND bg.user_id = pm.user_id
           WHERE pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'))
       ) AS allowed`,
      [boardId, actorId],
    );
    if (!allowed.rows[0]?.allowed) {
      throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
  }

  return { data: summaries };
}
