import crypto from 'node:crypto';
import type pg from 'pg';
import { HttpError } from '../http/errors.ts';
import {
  type Board,
  type BoardSnapshotData,
  type BoardSnapshotQuery,
  type Column,
  type CreateColumnInput,
  type UpdateColumnInput,
  type PlacementResult,
  type CardSummary,
  type ColumnTone,
  type CardListResponse,
  type PersonDisplay,
  type CardsQuery,
  type Role,
  type Priority,
} from '@flowboard/contracts';
import { acquireWriteGrantLock, resolveProjectRole } from './rbac.ts';
import { lockBoardAccess } from './board-grants-foundation.ts';
import { recordActivity } from './activity.ts';
import { getPool } from './postgres.ts';

async function requireBoardRead(client: pg.Pool | pg.ClientBase, boardId: string, projectId: string, actorId: string): Promise<Role> {
  const role = await resolveProjectRole(projectId, actorId, client);
  if (!role) throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  if (role !== 'owner') {
    const grant = await client.query(
      'SELECT 1 FROM board_grants WHERE board_id = $1 AND project_id = $2 AND user_id = $3',
      [boardId, projectId, actorId],
    );
    if (!grant.rows[0]) throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }
  return role;
}

export function getWorkspaceToday(timezone = 'UTC'): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export interface CardCursorPayload {
  bId: string;
  fH: string;
  /** Snapshot revision invalidates pages when displayed card data or counts change. */
  sV: number;
  /** Structure revision invalidates pages when canonical ordering changes. */
  oV: number;
  position: number;
  id: string;
}

export function computeCardFilterHash(filters: {
  columnId?: string | undefined;
  query?: string | undefined;
  titleQuery?: string | undefined;
  priority?: Priority | undefined;
  assigneeId?: string | undefined;
  due?: string | undefined;
  asOfDate?: string | undefined;
}): string {
  const norm = [
    filters.columnId ?? '',
    (filters.titleQuery ?? filters.query ?? '').trim(),
    filters.priority ?? '',
    filters.assigneeId ?? '',
    filters.due ?? '',
    filters.asOfDate ?? '',
  ].join('|');
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

export function encodeCardCursor(card: {
  boardId: string;
  filterHash: string;
  snapshotVersion: number;
  structureVersion: number;
  position: number;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      bId: card.boardId,
      fH: card.filterHash,
      sV: card.snapshotVersion,
      oV: card.structureVersion,
      position: card.position,
      id: card.id,
    }),
  ).toString('base64url');
}

export function decodeCardCursor(cursor?: string): CardCursorPayload | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.bId === 'string' &&
      typeof parsed.fH === 'string' &&
      typeof parsed.sV === 'number' &&
      typeof parsed.oV === 'number' &&
      typeof parsed.position === 'number' &&
      typeof parsed.id === 'string'
    ) {
      return parsed as CardCursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * BRD-01: Create board with atomic default columns.
 * Workspace owner and project manager can create boards.
 * Atomically inserts exactly 5 default columns in order (new boards only; existing boards are
 * never changed):
 * 1. "Not started" (category: 'todo', color: '#64748b', position: 0)
 * 2. "In progress" (category: 'active', color: '#0ea5e9', position: 1)
 * 3. "Testing" (category: 'active', color: '#f59e0b', position: 2)
 * 4. "Blocked" (category: 'active', color: '#ef4444', position: 3)
 * 5. "Completed" (category: 'done', color: '#10b981', position: 4)
 */
export async function createBoard(
  client: pg.ClientBase,
  projectId: string,
  name: string,
  actorId: string,
  description: string | null = null,
): Promise<Board> {
  // 1. Verify owner or manager role via grant lock
  await acquireWriteGrantLock(client, projectId, actorId, 'manager');

  // 2. Fetch project workspace_id
  const prjRes = await client.query<{ id: string; workspace_id: string }>(
    `SELECT id, workspace_id FROM projects WHERE id = $1`,
    [projectId],
  );
  if (prjRes.rows.length === 0 || !prjRes.rows[0]) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }
  const workspaceId = prjRes.rows[0].workspace_id;

  const boardId = 'brd_' + crypto.randomUUID();
  const nowIso = new Date().toISOString();

  // 3. Insert board
  const boardRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    name: string;
    description: string | null;
    structure_version: number;
    snapshot_version: number;
    archived: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO boards (
       id, workspace_id, project_id, name, description,
       structure_version, snapshot_version, archived,
       created_at, updated_at, created_by
     ) VALUES ($1, $2, $3, $4, $5, 1, 1, FALSE, $6, $6, $7)
     RETURNING id, workspace_id, project_id, name, description, structure_version, snapshot_version, archived, created_at, updated_at`,
    [boardId, workspaceId, projectId, name.trim(), description, nowIso, actorId],
  );

  const bRow = boardRes.rows[0];
  if (!bRow) {
    throw new Error('Failed to insert board.');
  }

  // 4. Atomically insert 5 default columns
  const defaultCols: Array<{ name: string; category: 'todo' | 'active' | 'done'; color: string; position: number }> = [
    { name: 'Not started', category: 'todo', color: '#64748b', position: 0 },
    { name: 'In progress', category: 'active', color: '#0ea5e9', position: 1 },
    { name: 'Testing', category: 'active', color: '#f59e0b', position: 2 },
    { name: 'Blocked', category: 'active', color: '#ef4444', position: 3 },
    { name: 'Completed', category: 'done', color: '#10b981', position: 4 },
  ];

  for (const col of defaultCols) {
    const colId = 'col_' + crypto.randomUUID();
    await client.query(
      `INSERT INTO columns (
         id, workspace_id, project_id, board_id,
         name, color, category, position, version,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $9)`,
      [colId, workspaceId, projectId, boardId, col.name, col.color, col.category, col.position, nowIso],
    );
  }

  // Board-scoped: only people who can read the new board see this row.
  await recordActivity(client, {
    workspaceId,
    projectId,
    boardId,
    visibilityScope: 'board',
    actorId,
    action: 'board_created',
    safeChanges: { name: bRow.name },
  });

  return {
    id: bRow.id,
    workspaceId: bRow.workspace_id,
    projectId: bRow.project_id,
    name: bRow.name,
    description: bRow.description,
    isArchived: Boolean(bRow.archived),
    structureVersion: bRow.structure_version,
    snapshotVersion: bRow.snapshot_version,
    createdAt: new Date(bRow.created_at).toISOString(),
    updatedAt: new Date(bRow.updated_at).toISOString(),
  };
}

/**
 * BRD-02: List boards for a project.
 * Non-members receive 404 NOT_FOUND. Returns active boards.
 */
export async function listProjectBoards(
  clientOrPool: pg.Pool | pg.ClientBase,
  projectId: string,
  actorId: string,
  authorizedBoardIds?: string[] | null,
): Promise<{ data: Board[]; nextCursor: string | null }> {
  const pool = clientOrPool ?? getPool();

  // 1. Verify actor has project access
  const role = await resolveProjectRole(projectId, actorId, pool);
  if (!role) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }

  let res: pg.QueryResult<{
    id: string;
    workspace_id: string;
    project_id: string;
    name: string;
    description: string | null;
    structure_version: number;
    snapshot_version: number;
    archived: boolean;
    created_at: Date;
    updated_at: Date;
  }>;

  if (role !== 'owner') {
    res = await pool.query(
      `SELECT b.id, b.workspace_id, b.project_id, b.name, b.description, b.structure_version, b.snapshot_version, b.archived, b.created_at, b.updated_at
       FROM boards b
       JOIN board_grants bg ON bg.board_id = b.id AND bg.project_id = b.project_id AND bg.user_id = $2
       WHERE b.project_id = $1 AND b.archived = FALSE
         AND ($3::text[] IS NULL OR b.id = ANY($3::text[]))
       ORDER BY b.created_at ASC, b.id ASC`,
      [projectId, actorId, authorizedBoardIds ?? null],
    );
  } else {
    res = await pool.query(
      `SELECT id, workspace_id, project_id, name, description, structure_version, snapshot_version, archived, created_at, updated_at
       FROM boards
       WHERE project_id = $1 AND archived = FALSE
       ORDER BY created_at ASC, id ASC`,
      [projectId],
    );
  }

  const boards: Board[] = res.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    isArchived: Boolean(row.archived),
    structureVersion: row.structure_version,
    snapshotVersion: row.snapshot_version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));

  return {
    data: boards,
    nextCursor: null,
  };
}

/**
 * BRD-02: Update board name and/or description with OCC.
 * Owner only: a Project Manager with a board grant gets 403; a user with no board grant gets 404
 * (the board boundary is checked first, so a grantless user cannot learn the board exists).
 * Verifies expectedVersion === snapshot_version. At least one field must be present.
 */
export async function updateBoard(
  client: pg.ClientBase,
  boardId: string,
  input: { name?: string | undefined; description?: string | null | undefined },
  expectedVersion: number,
  actorId: string,
): Promise<Board> {
  await lockBoardAccess(client, boardId, actorId);
  // 1. Lock board row
  const bRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    name: string;
    structure_version: number;
    snapshot_version: number;
    archived: boolean;
  }>(
    `SELECT id, workspace_id, project_id, name, structure_version, snapshot_version, archived
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [boardId],
  );

  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }

  const boardRow = bRes.rows[0];

  // 2. Board visibility and manager-or-higher role, then the owner-only rule for name and description.
  const grant = await acquireWriteGrantLock(client, boardRow.project_id, actorId, 'manager', boardId);
  if (!grant.isOwner) {
    throw HttpError.forbidden(
      'Only the project owner can change a board name or description.',
      'FORBIDDEN',
    );
  }

  // 3. Concurrency check (OCC on snapshot_version)
  if (boardRow.snapshot_version !== expectedVersion) {
    throw HttpError.conflict('Stale board snapshot version.', 'STALE_VERSION');
  }

  // 4. Update board. Each field changes only when the caller sent it; null clears the description.
  const updateRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    name: string;
    description: string | null;
    structure_version: number;
    snapshot_version: number;
    archived: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `UPDATE boards
     SET name = CASE WHEN $1::boolean THEN $2 ELSE name END,
         description = CASE WHEN $3::boolean THEN $4 ELSE description END,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $5
     RETURNING id, workspace_id, project_id, name, description, structure_version, snapshot_version, archived, created_at, updated_at`,
    [
      input.name !== undefined,
      input.name?.trim() ?? null,
      input.description !== undefined,
      input.description ?? null,
      boardId,
    ],
  );

  const row = updateRes.rows[0];
  if (!row) {
    throw new Error('Failed to update board.');
  }

  // One row per field the caller sent. Description text is never copied into the log.
  if (input.name !== undefined) {
    await recordActivity(client, {
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      boardId,
      visibilityScope: 'board',
      actorId,
      action: 'board_renamed',
      safeChanges: { name: row.name },
    });
  }
  if (input.description !== undefined) {
    await recordActivity(client, {
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      boardId,
      visibilityScope: 'board',
      actorId,
      action: 'board_described',
      safeChanges: { cleared: input.description === null },
    });
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    isArchived: Boolean(row.archived),
    structureVersion: row.structure_version,
    snapshotVersion: row.snapshot_version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * BRD-04: Add column to board.
 * Owner or manager only. Max 12 columns. Unique case-insensitive trimmed name.
 */
export async function addColumn(
  client: pg.ClientBase,
  boardId: string,
  input: CreateColumnInput,
  actorId: string,
): Promise<Column> {
  await lockBoardAccess(client, boardId, actorId);
  // 1. Lock board row
  const bRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    structure_version: number;
    snapshot_version: number;
  }>(
    `SELECT id, workspace_id, project_id, structure_version, snapshot_version
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [boardId],
  );

  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }

  const boardRow = bRes.rows[0];

  // 2. Authorization
  await acquireWriteGrantLock(client, boardRow.project_id, actorId, 'manager', boardId);

  // 3. Concurrency check (structure_version)
  if (boardRow.structure_version !== input.expectedBoardVersion) {
    throw HttpError.conflict('Stale board structure version.', 'STALE_VERSION');
  }

  // 4. Bound check: max 12 columns
  const countRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM columns WHERE board_id = $1`,
    [boardId],
  );
  if (parseInt(countRes.rows[0]?.count ?? '0', 10) >= 12) {
    throw HttpError.badRequest('A board cannot have more than 12 columns.', 'COLUMN_LIMIT_EXCEEDED');
  }

  // 5. Duplicate name check (case-insensitive, trimmed)
  const trimmedName = input.name.trim();
  const dupRes = await client.query<{ id: string }>(
    `SELECT id FROM columns WHERE board_id = $1 AND LOWER(TRIM(name)) = LOWER($2)`,
    [boardId, trimmedName],
  );
  if (dupRes.rows.length > 0) {
    throw HttpError.conflict('A column with this name already exists on the board.', 'DUPLICATE_COLUMN_NAME');
  }

  // 6. Next position = max(position) + 1
  const posRes = await client.query<{ next_pos: number }>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_pos FROM columns WHERE board_id = $1`,
    [boardId],
  );
  const nextPos = posRes.rows[0]?.next_pos ?? 0;

  // 7. Insert column
  const colId = 'col_' + crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const insertRes = await client.query<{
    id: string;
    board_id: string;
    name: string;
    category: 'todo' | 'active' | 'done';
    color: string;
    position: number;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO columns (
       id, workspace_id, project_id, board_id,
       name, color, category, position, version,
       created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $9)
     RETURNING id, board_id, name, category, color, position, created_at, updated_at`,
    [colId, boardRow.workspace_id, boardRow.project_id, boardId, trimmedName, input.color.trim(), input.category, nextPos, nowIso],
  );

  const colRow = insertRes.rows[0];
  if (!colRow) {
    throw new Error('Failed to insert column.');
  }

  // 8. Update board versions
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [boardId],
  );

  await recordActivity(client, {
    workspaceId: boardRow.workspace_id,
    projectId: boardRow.project_id,
    boardId,
    visibilityScope: 'board',
    actorId,
    action: 'column_added',
    safeChanges: { columnId: colRow.id, name: trimmedName, category: input.category },
  });

  return {
    id: colRow.id,
    boardId: colRow.board_id,
    name: colRow.name,
    category: colRow.category,
    color: colRow.color,
    position: colRow.position,
    activeCardCount: 0,
    matchingCardCount: 0,
    createdAt: new Date(colRow.created_at).toISOString(),
    updatedAt: new Date(colRow.updated_at).toISOString(),
  };
}

/**
 * BRD-04: Update column.
 * Owner or manager only. Case-insensitive duplicate name check.
 */
export async function updateColumn(
  client: pg.ClientBase,
  boardId: string,
  columnId: string,
  input: UpdateColumnInput,
  actorId: string,
): Promise<Column> {
  await lockBoardAccess(client, boardId, actorId);
  // 1. Lock board row
  const bRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    structure_version: number;
    snapshot_version: number;
  }>(
    `SELECT id, workspace_id, project_id, structure_version, snapshot_version
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [boardId],
  );

  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }

  const boardRow = bRes.rows[0];

  // 2. Authorization
  await acquireWriteGrantLock(client, boardRow.project_id, actorId, 'manager', boardId);

  // 3. Concurrency check
  if (boardRow.structure_version !== input.expectedBoardVersion) {
    throw HttpError.conflict('Stale board structure version.', 'STALE_VERSION');
  }

  // 4. Lock column
  const colRes = await client.query<{
    id: string;
    name: string;
    color: string;
    category: 'todo' | 'active' | 'done';
    position: number;
  }>(
    `SELECT id, name, color, category, position
     FROM columns
     WHERE id = $1 AND board_id = $2
     FOR UPDATE`,
    [columnId, boardId],
  );

  if (colRes.rows.length === 0 || !colRes.rows[0]) {
    throw HttpError.notFound('Column not found.', 'NOT_FOUND');
  }

  const existingCol = colRes.rows[0];

  // 5. Duplicate name check if renaming
  let newName = existingCol.name;
  if (input.name !== undefined) {
    newName = input.name.trim();
    const dupRes = await client.query<{ id: string }>(
      `SELECT id FROM columns
       WHERE board_id = $1 AND LOWER(TRIM(name)) = LOWER($2) AND id != $3`,
      [boardId, newName, columnId],
    );
    if (dupRes.rows.length > 0) {
      throw HttpError.conflict('A column with this name already exists on the board.', 'DUPLICATE_COLUMN_NAME');
    }
  }

  const newColor = input.color !== undefined ? input.color.trim() : existingCol.color;
  const newCategory = input.category !== undefined ? input.category : existingCol.category;

  // 6. Update column
  const updateRes = await client.query<{
    id: string;
    board_id: string;
    name: string;
    category: 'todo' | 'active' | 'done';
    color: string;
    position: number;
    created_at: Date;
    updated_at: Date;
  }>(
    `UPDATE columns
     SET name = $1, color = $2, category = $3, version = version + 1, updated_at = NOW()
     WHERE id = $4 AND board_id = $5
     RETURNING id, board_id, name, category, color, position, created_at, updated_at`,
    [newName, newColor, newCategory, columnId, boardId],
  );

  const row = updateRes.rows[0];
  if (!row) {
    throw new Error('Failed to update column.');
  }

  // 7. Update board versions
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [boardId],
  );

  // One row per field the caller changed (rename, recolour, recategorise).
  const columnEvent = { workspaceId: boardRow.workspace_id, projectId: boardRow.project_id, boardId, actorId };
  if (input.name !== undefined) {
    await recordActivity(client, {
      ...columnEvent, visibilityScope: 'board', action: 'column_renamed', safeChanges: { columnId, name: newName },
    });
  }
  if (input.color !== undefined) {
    await recordActivity(client, {
      ...columnEvent, visibilityScope: 'board', action: 'column_recoloured', safeChanges: { columnId, color: newColor },
    });
  }
  if (input.category !== undefined) {
    await recordActivity(client, {
      ...columnEvent, visibilityScope: 'board', action: 'column_recategorised', safeChanges: { columnId, category: newCategory },
    });
  }

  // 8. Query active card count for column
  const cardCountRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM cards WHERE column_id = $1 AND state = 'active'`,
    [columnId],
  );
  const cardCount = parseInt(cardCountRes.rows[0]?.count ?? '0', 10);

  return {
    id: row.id,
    boardId: row.board_id,
    name: row.name,
    category: row.category,
    color: row.color,
    position: row.position,
    activeCardCount: cardCount,
    matchingCardCount: cardCount,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * BRD-05: Reorder columns atomically.
 * columnIds must match exact set of columns on the board.
 */
export async function reorderColumns(
  client: pg.ClientBase,
  boardId: string,
  columnIds: string[],
  expectedBoardVersion: number,
  actorId: string,
): Promise<{ id: string; structureVersion: number; snapshotVersion: number }> {
  await lockBoardAccess(client, boardId, actorId);
  // 1. Lock board row
  const bRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    structure_version: number;
    snapshot_version: number;
  }>(
    `SELECT id, workspace_id, project_id, structure_version, snapshot_version
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [boardId],
  );

  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }

  const boardRow = bRes.rows[0];

  // 2. Authorization
  await acquireWriteGrantLock(client, boardRow.project_id, actorId, 'manager', boardId);

  // 3. Concurrency check
  if (boardRow.structure_version !== expectedBoardVersion) {
    throw HttpError.conflict('Stale board structure version.', 'STALE_VERSION');
  }

  // 4. Exact column set validation
  const colsRes = await client.query<{ id: string }>(
    `SELECT id FROM columns WHERE board_id = $1`,
    [boardId],
  );

  const existingIds = new Set(colsRes.rows.map((r) => r.id));
  const uniqueInputIds = new Set(columnIds);

  if (
    columnIds.length !== existingIds.size ||
    uniqueInputIds.size !== columnIds.length ||
    columnIds.some((id) => !existingIds.has(id))
  ) {
    throw HttpError.badRequest(
      'Provided columnIds must match the exact set of columns on the board.',
      'INVALID_COLUMN_ORDER',
    );
  }

  // 5. Update positions sequentially
  for (let i = 0; i < columnIds.length; i++) {
    await client.query(
      `UPDATE columns SET position = $1, updated_at = NOW() WHERE id = $2 AND board_id = $3`,
      [i, columnIds[i], boardId],
    );
  }

  // 6. Update board versions
  const bUpdate = await client.query<{ structure_version: number; snapshot_version: number }>(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1
     RETURNING structure_version, snapshot_version`,
    [boardId],
  );

  const updatedBoard = bUpdate.rows[0]!;

  await recordActivity(client, {
    workspaceId: boardRow.workspace_id,
    projectId: boardRow.project_id,
    boardId,
    visibilityScope: 'board',
    actorId,
    action: 'columns_reordered',
    safeChanges: { columnIds },
  });

  return {
    id: boardId,
    structureVersion: updatedBoard.structure_version,
    snapshotVersion: updatedBoard.snapshot_version,
  };
}

/**
 * BRD-06: Delete empty column.
 * Reject if only 1 column remains on the board.
 * Reject if column contains active cards.
 * Reject if column contains restorable cards in trash (restore_until > NOW()).
 */
export async function deleteColumn(
  client: pg.ClientBase,
  boardId: string,
  columnId: string,
  expectedBoardVersion: number,
  actorId: string,
): Promise<{ id: string; structureVersion: number; snapshotVersion: number }> {
  await lockBoardAccess(client, boardId, actorId);
  // 1. Lock board row
  const bRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    structure_version: number;
    snapshot_version: number;
  }>(
    `SELECT id, workspace_id, project_id, structure_version, snapshot_version
     FROM boards
     WHERE id = $1
     FOR UPDATE`,
    [boardId],
  );

  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }

  const boardRow = bRes.rows[0];

  // 2. Authorization
  await acquireWriteGrantLock(client, boardRow.project_id, actorId, 'manager', boardId);

  // 3. Concurrency check
  if (boardRow.structure_version !== expectedBoardVersion) {
    throw HttpError.conflict('Stale board structure version.', 'STALE_VERSION');
  }

  // 4. Lock column
  const colRes = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM columns WHERE id = $1 AND board_id = $2 FOR UPDATE`,
    [columnId, boardId],
  );

  if (colRes.rows.length === 0 || !colRes.rows[0]) {
    throw HttpError.notFound('Column not found.', 'NOT_FOUND');
  }
  const deletedColumnName = colRes.rows[0].name;

  // 5. Final column check
  const totalColsRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM columns WHERE board_id = $1`,
    [boardId],
  );
  if (parseInt(totalColsRes.rows[0]?.count ?? '0', 10) <= 1) {
    throw HttpError.badRequest('Cannot delete the final column of a board.', 'FINAL_COLUMN_CANNOT_BE_DELETED');
  }

  // 6. Active cards check
  const activeCardsRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM cards WHERE column_id = $1 AND state = 'active'`,
    [columnId],
  );
  if (parseInt(activeCardsRes.rows[0]?.count ?? '0', 10) > 0) {
    throw HttpError.conflict('Column contains active cards and cannot be deleted.', 'COLUMN_HAS_ACTIVE_CARDS');
  }

  // 7. Restorable cards in trash check (restore_until > NOW())
  const restorableCardsRes = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM cards WHERE column_id = $1 AND state = 'trashed' AND restore_until > NOW()`,
    [columnId],
  );
  if (parseInt(restorableCardsRes.rows[0]?.count ?? '0', 10) > 0) {
    throw HttpError.conflict('Column contains restorable cards and cannot be deleted.', 'COLUMN_HAS_RESTORABLE_CARDS');
  }

  // 8. Delete column
  await client.query(`DELETE FROM columns WHERE id = $1 AND board_id = $2`, [columnId, boardId]);

  // 9. Recompact remaining columns to position 0..N-1
  const remainingColsRes = await client.query<{ id: string }>(
    `SELECT id FROM columns WHERE board_id = $1 ORDER BY position ASC, id ASC`,
    [boardId],
  );
  for (let i = 0; i < remainingColsRes.rows.length; i++) {
    await client.query(
      `UPDATE columns SET position = $1, updated_at = NOW() WHERE id = $2 AND board_id = $3`,
      [i, remainingColsRes.rows[i]!.id, boardId],
    );
  }

  // 10. Update board versions
  const bUpdate = await client.query<{ structure_version: number; snapshot_version: number }>(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1
     RETURNING structure_version, snapshot_version`,
    [boardId],
  );

  const updatedBoard = bUpdate.rows[0]!;

  await recordActivity(client, {
    workspaceId: boardRow.workspace_id,
    projectId: boardRow.project_id,
    boardId,
    visibilityScope: 'board',
    actorId,
    action: 'column_deleted',
    safeChanges: { columnId, name: deletedColumnName },
  });

  return {
    id: columnId,
    structureVersion: updatedBoard.structure_version,
    snapshotVersion: updatedBoard.snapshot_version,
  };
}

/**
 * BRD-05/CRD-07: Get card placement neighbor calculation.
 * Computes previousCardId and nextCardId for first, last, before, after placement.
 */
export async function getPlacement(
  clientOrPool: pg.Pool | pg.ClientBase,
  boardId: string,
  columnId: string,
  movingCardId: string,
  at: 'first' | 'last' | 'before' | 'after',
  anchorCardId?: string,
  actorId?: string,
): Promise<PlacementResult> {
  const pool = clientOrPool ?? getPool();

  // 1. Verify board and column exist
  const bRes = await pool.query<{
    id: string;
    project_id: string;
    workspace_id: string;
    structure_version: number;
  }>(
    `SELECT b.id, b.project_id, b.workspace_id, b.structure_version
     FROM boards b
     JOIN columns c ON c.board_id = b.id AND c.id = $2
     WHERE b.id = $1`,
    [boardId, columnId],
  );

  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound('Board or column not found.', 'NOT_FOUND');
  }

  const boardRow = bRes.rows[0];

  // 2. Check actor authorization if actorId provided
  if (actorId) {
    await requireBoardRead(pool, boardId, boardRow.project_id, actorId);
  }

  // 3. Verify movingCardId exists, is active, and belongs to this board (F-02)
  const movingCardRes = await pool.query<{
    id: string;
    board_id: string;
    project_id: string;
    workspace_id: string;
    state: string;
  }>(
    `SELECT id, board_id, project_id, workspace_id, state FROM cards WHERE id = $1`,
    [movingCardId],
  );

  if (movingCardRes.rows.length === 0 || movingCardRes.rows[0]?.state !== 'active') {
    throw HttpError.notFound('Moving card not found.', 'NOT_FOUND');
  }
  if (
    movingCardRes.rows[0].board_id !== boardId ||
    movingCardRes.rows[0].project_id !== boardRow.project_id ||
    movingCardRes.rows[0].workspace_id !== boardRow.workspace_id
  ) {
    throw HttpError.badRequest('Moving card does not belong to this board and project.', 'INVALID_MOVING_CARD');
  }

  if (anchorCardId && anchorCardId === movingCardId) {
    throw HttpError.badRequest('Anchor card cannot be the moving card.', 'INVALID_ANCHOR_CARD');
  }

  // 4. Query active cards in destination column excluding movingCardId
  const cardsRes = await pool.query<{ id: string }>(
    `SELECT id FROM cards
     WHERE column_id = $1 AND state = 'active' AND id != $2
     ORDER BY cards.position ASC, cards.id ASC`,
    [columnId, movingCardId],
  );

  const cards = cardsRes.rows;
  let previousCardId: string | null = null;
  let nextCardId: string | null = null;

  if (at === 'first') {
    previousCardId = null;
    nextCardId = cards[0]?.id ?? null;
  } else if (at === 'last') {
    previousCardId = cards.length > 0 ? (cards[cards.length - 1]?.id ?? null) : null;
    nextCardId = null;
  } else if (at === 'before') {
    if (!anchorCardId) {
      throw HttpError.badRequest('anchorCardId is required for placement before', 'VALIDATION_ERROR');
    }
    const idx = cards.findIndex((c) => c.id === anchorCardId);
    if (idx === -1) {
      throw HttpError.badRequest('Anchor card not found in destination column.', 'ANCHOR_CARD_NOT_FOUND');
    }
    previousCardId = idx > 0 ? (cards[idx - 1]?.id ?? null) : null;
    nextCardId = anchorCardId;
  } else if (at === 'after') {
    if (!anchorCardId) {
      throw HttpError.badRequest('anchorCardId is required for placement after', 'VALIDATION_ERROR');
    }
    const idx = cards.findIndex((c) => c.id === anchorCardId);
    if (idx === -1) {
      throw HttpError.badRequest('Anchor card not found in destination column.', 'ANCHOR_CARD_NOT_FOUND');
    }
    previousCardId = anchorCardId;
    nextCardId = idx < cards.length - 1 ? (cards[idx + 1]?.id ?? null) : null;
  }

  return {
    movingCardId,
    toColumnId: columnId,
    previousCardId,
    nextCardId,
    structureVersion: boardRow.structure_version,
  };
}

/**
 * Builds SQL filter clause for active cards.
 */
function buildCardFilterClauses(
  filters: {
    columnId?: string | undefined;
    titleQuery?: string | undefined;
    priority?: Priority | undefined;
    assigneeId?: string | undefined;
    due?: string | undefined;
  },
  asOfDate: string,
  paramStartIndex: number,
): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let paramIdx = paramStartIndex;

  if (filters.columnId) {
    clauses.push(`c.column_id = $${paramIdx++}`);
    params.push(filters.columnId);
  }

  if (filters.titleQuery && filters.titleQuery.trim().length > 0) {
    clauses.push(`c.title ILIKE '%' || $${paramIdx++} || '%'`);
    params.push(filters.titleQuery.trim());
  }

  if (filters.priority) {
    clauses.push(`c.priority = $${paramIdx++}`);
    params.push(filters.priority);
  }

  if (filters.assigneeId) {
    clauses.push(`EXISTS (SELECT 1 FROM card_assignees ca WHERE ca.card_id = c.id AND ca.user_id = $${paramIdx++})`);
    params.push(filters.assigneeId);
  }

  if (filters.due) {
    if (filters.due === 'overdue') {
      clauses.push(`c.due_date IS NOT NULL AND c.due_date < $${paramIdx++}::date AND col.category != 'done'`);
      params.push(asOfDate);
    } else if (filters.due === 'today') {
      clauses.push(`c.due_date = $${paramIdx++}::date`);
      params.push(asOfDate);
    } else if (filters.due === 'upcoming') {
      clauses.push(`c.due_date > $${paramIdx++}::date`);
      params.push(asOfDate);
    } else if (filters.due === 'none') {
      clauses.push(`c.due_date IS NULL`);
    }
  }

  return {
    sql: clauses.length > 0 ? ' AND ' + clauses.join(' AND ') : '',
    params,
  };
}

/**
 * BRD-03: Get bounded consistent board snapshot.
 * Multi-query executed under a consistent snapshot while holding the actor's
 * board grant. Revocation must wait until this snapshot finishes.
 */
export async function getBoardSnapshot(
  pool: pg.Pool,
  boardId: string,
  actorId: string,
  query?: BoardSnapshotQuery,
): Promise<BoardSnapshotData> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    // Acquire authorization locks before reading private board data. A plain
    // SELECT inside a repeatable-read snapshot could retain a revoked grant.
    await lockBoardAccess(client, boardId, actorId);

    // 1. Fetch board and workspace details
    const bRes = await client.query<{
      id: string;
      workspace_id: string;
      project_id: string;
      name: string;
      structure_version: number;
      snapshot_version: number;
      archived: boolean;
      created_at: Date;
      updated_at: Date;
      timezone: string;
      description: string | null;
    }>(
      `SELECT b.id, b.workspace_id, b.project_id, b.name, b.description,
              b.structure_version, b.snapshot_version, b.archived,
              b.created_at, b.updated_at, w.timezone
       FROM boards b
       JOIN workspaces w ON w.id = b.workspace_id
       WHERE b.id = $1`,
      [boardId],
    );

    if (bRes.rows.length === 0 || !bRes.rows[0]) {
      throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }

    const bRow = bRes.rows[0];

    const asOfDate = getWorkspaceToday(bRow.timezone);
    const cardLimit = Math.max(1, Math.min(query?.cardLimitPerColumn ?? 10, 15));

    // 3. Fetch columns ordered by position ASC
    const colsRes = await client.query<{
      id: string;
      board_id: string;
      name: string;
      category: 'todo' | 'active' | 'done';
      color: string;
      tone: ColumnTone | null;
      position: number;
    }>(
      `SELECT id, board_id, name, category, color, tone, position
       FROM columns
       WHERE board_id = $1
       ORDER BY position ASC`,
      [boardId],
    );

    const columnsList = colsRes.rows;

    // 4. Query active counts per column (ignoring filters, excluding trash)
    const activeCountsRes = await client.query<{ column_id: string; count: string }>(
      `SELECT col.id AS column_id, COUNT(c.id)::text AS count
       FROM columns col
       LEFT JOIN cards c ON c.column_id = col.id AND c.state = 'active'
       WHERE col.board_id = $1
       GROUP BY col.id`,
      [boardId],
    );
    const activeCountMap = new Map<string, number>();
    for (const r of activeCountsRes.rows) {
      activeCountMap.set(r.column_id, parseInt(r.count, 10));
    }

    // 5. Query matching counts per column (applying all filters)
    const filterClauses = buildCardFilterClauses(
      {
        titleQuery: query?.titleQuery,
        priority: query?.priority,
        assigneeId: query?.assigneeId,
        due: query?.due,
      },
      asOfDate,
      2,
    );

    const matchingCountsRes = await client.query<{ column_id: string; count: string }>(
      `SELECT col.id AS column_id, COUNT(c.id)::text AS count
       FROM columns col
       LEFT JOIN cards c ON c.column_id = col.id AND c.state = 'active'
       ${filterClauses.sql}
       WHERE col.board_id = $1
       GROUP BY col.id`,
      [boardId, ...filterClauses.params],
    );
    const matchingCountMap = new Map<string, number>();
    for (const r of matchingCountsRes.rows) {
      matchingCountMap.set(r.column_id, parseInt(r.count, 10));
    }

    // 5b. Board-wide due counters (ignore filters; same overdue rule as the due filter, done columns excluded).
    const dueCountsRes = await client.query<{ overdue: string; due_soon: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE c.due_date < $2::date)::text AS overdue,
         COUNT(*) FILTER (WHERE c.due_date >= $2::date AND c.due_date <= ($2::date + 7))::text AS due_soon
       FROM cards c
       JOIN columns col ON col.id = c.column_id
       WHERE c.board_id = $1 AND c.state = 'active' AND c.due_date IS NOT NULL AND col.category <> 'done'`,
      [boardId, asOfDate],
    );
    const dueCounts = {
      overdue: Number(dueCountsRes.rows[0]?.overdue ?? 0),
      dueSoon: Number(dueCountsRes.rows[0]?.due_soon ?? 0),
    };

    // 6. Query cards per column up to cardLimit + 1
    const cardsParamStart = 2 + filterClauses.params.length;
    const cardsQueryRes = await client.query<{
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
      comment_count: number;
      image_count: number;
      assignee_ids: string[];
      card_key: string;
      description_excerpt: string;
      row_num: string;
    }>(
      `WITH filtered_cards AS (
         SELECT
           c.id,
           c.board_id,
           c.column_id,
           c.title,
           p.key_prefix || '-' || c.card_number::text AS card_key,
           LEFT(BTRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(c.description, ''), '<[^>]*>|[#*_\`~>\\[\\]]', ' ', 'g'), '\\s+', ' ', 'g')), 160) AS description_excerpt,
           c.priority,
           TO_CHAR(c.due_date, 'YYYY-MM-DD') AS due_date,
           c.position,
           c.version,
           c.created_at,
           c.updated_at,
           COALESCE(comm.comment_count, 0)::int AS comment_count,
           COALESCE(img.image_count, 0)::int AS image_count,
           COALESCE(assignees.user_ids, ARRAY[]::text[]) AS assignee_ids,
           ROW_NUMBER() OVER (PARTITION BY c.column_id ORDER BY c.position ASC, c.id ASC) AS row_num
         FROM cards c
         JOIN columns col ON col.id = c.column_id
         JOIN projects p ON p.id = c.project_id
         LEFT JOIN (
           SELECT card_id, COUNT(*)::int AS comment_count
           FROM comments
           WHERE deleted_at IS NULL
           GROUP BY card_id
         ) comm ON comm.card_id = c.id
         LEFT JOIN (
           SELECT card_id, COUNT(*)::int AS image_count
           FROM card_images
           GROUP BY card_id
         ) img ON img.card_id = c.id
         LEFT JOIN (
           SELECT card_id, ARRAY_AGG(user_id ORDER BY user_id ASC) AS user_ids
           FROM card_assignees
           GROUP BY card_id
         ) assignees ON assignees.card_id = c.id
         WHERE c.board_id = $1 AND c.state = 'active'
           ${filterClauses.sql}
       )
       SELECT * FROM filtered_cards
       WHERE row_num <= $${cardsParamStart}
       ORDER BY column_id, row_num ASC`,
      [boardId, ...filterClauses.params, cardLimit + 1],
    );

    // Group cards by column_id
    const cardsByCol = new Map<string, typeof cardsQueryRes.rows>();
    for (const cardRow of cardsQueryRes.rows) {
      let list = cardsByCol.get(cardRow.column_id);
      if (!list) {
        list = [];
        cardsByCol.set(cardRow.column_id, list);
      }
      list.push(cardRow);
    }

    // 7. Distinct people referenced on active cards of the board
    const peopleRes = await client.query<{
      id: string;
      display_name: string;
      avatar_url: string | null;
      active_in_project: boolean;
      scoped_role: Role | null;
      assignable: boolean;
      mentionable: boolean;
    }>(
      `SELECT DISTINCT
         u.id,
         u.display_name,
         u.avatar_url,
         CASE
           WHEN w.owner_id = u.id THEN TRUE
           WHEN pm.status = 'active' THEN TRUE
           ELSE FALSE
         END AS active_in_project,
         CASE
           WHEN w.owner_id = u.id THEN 'owner'
           WHEN pm.id IS NOT NULL THEN pm.role
           ELSE NULL
         END AS scoped_role,
         CASE
           WHEN w.owner_id = u.id THEN TRUE
           WHEN pm.status = 'active' AND pm.role IN ('manager', 'member') THEN TRUE
           ELSE FALSE
         END AS assignable,
         CASE
           WHEN w.owner_id = u.id THEN TRUE
           WHEN pm.status = 'active' THEN TRUE
           ELSE FALSE
         END AS mentionable
       FROM card_assignees ca
       JOIN cards c ON c.id = ca.card_id
       JOIN users u ON u.id = ca.user_id
       JOIN projects p ON p.id = c.project_id
       JOIN workspaces w ON w.id = p.workspace_id
       LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = u.id
       WHERE c.board_id = $1 AND c.state = 'active'
       ORDER BY u.display_name ASC, u.id ASC`,
      [boardId],
    );

    const people: PersonDisplay[] = peopleRes.rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      activeInProject: Boolean(r.active_in_project),
      ...(r.scoped_role ? { scopedRole: r.scoped_role } : {}),
      assignable: Boolean(r.assignable),
      mentionable: Boolean(r.mentionable),
    }));

    await client.query('COMMIT');

    // 8. Assemble column summaries
    let totalActiveCount = 0;
    let totalMatchingCount = 0;

    const columnSummaries = columnsList.map((col) => {
      const activeCount = activeCountMap.get(col.id) ?? 0;
      const matchingCount = matchingCountMap.get(col.id) ?? 0;
      totalActiveCount += activeCount;
      totalMatchingCount += matchingCount;

      const rawCards = cardsByCol.get(col.id) ?? [];
      const hasMore = rawCards.length > cardLimit;
      const visibleCards = hasMore ? rawCards.slice(0, cardLimit) : rawCards;

      const cardSummaries: CardSummary[] = visibleCards.map((c) => ({
        id: c.id,
        boardId: c.board_id,
        columnId: c.column_id,
        title: c.title,
        priority: c.priority,
        dueDate: c.due_date,
        assigneeIds: c.assignee_ids,
        position: Number(c.position),
        version: c.version,
        commentCount: c.comment_count,
        imageCount: c.image_count,
        key: c.card_key,
        descriptionExcerpt: c.description_excerpt,
        createdAt: new Date(c.created_at).toISOString(),
        updatedAt: new Date(c.updated_at).toISOString(),
      }));

      const colFilterHash = computeCardFilterHash({
        columnId: col.id,
        titleQuery: query?.titleQuery,
        priority: query?.priority,
        assigneeId: query?.assigneeId,
        due: query?.due,
        asOfDate,
      });

      const nextCursor =
        hasMore && visibleCards.length > 0
          ? encodeCardCursor({
              boardId,
              filterHash: colFilterHash,
              snapshotVersion: bRow.snapshot_version,
              structureVersion: bRow.structure_version,
              position: Number(visibleCards[visibleCards.length - 1]!.position),
              id: visibleCards[visibleCards.length - 1]!.id,
            })
          : null;

      return {
        id: col.id,
        name: col.name,
        category: col.category,
        color: col.color,
        tone: col.tone,
        position: col.position,
        activeCardCount: activeCount,
        matchingCardCount: matchingCount,
        cards: cardSummaries,
        nextCursor,
      };
    });

    return {
      board: {
        id: bRow.id,
        workspaceId: bRow.workspace_id,
        projectId: bRow.project_id,
        name: bRow.name,
        description: bRow.description,
        isArchived: Boolean(bRow.archived),
        structureVersion: bRow.structure_version,
        snapshotVersion: bRow.snapshot_version,
        createdAt: new Date(bRow.created_at).toISOString(),
        updatedAt: new Date(bRow.updated_at).toISOString(),
      },
      filters: {
        titleQuery: query?.titleQuery ?? null,
        priority: query?.priority ?? null,
        assigneeId: query?.assigneeId ?? null,
        due: query?.due ?? null,
      },
      asOfDate,
      totals: {
        activeCardCount: totalActiveCount,
        matchingCardCount: totalMatchingCount,
        overdueCount: dueCounts.overdue,
        dueSoonCount: dueCounts.dueSoon,
      },
      columns: columnSummaries,
      people,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // PostgreSQL may abort the repeatable-read transaction if a concurrent
    // revocation wins before the grant lock. Return no board data in that case.
    if ((err as { code?: string })?.code === '40001') {
      throw HttpError.conflict('Board access changed. Retry the request.', 'ACCESS_CHANGED');
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * BRD-07: List cards in canonical position order with cursor pagination.
 */
export async function listBoardCards(
  clientOrPool: pg.Pool | pg.ClientBase,
  boardId: string,
  query: CardsQuery,
  actorId: string,
): Promise<CardListResponse> {
  const pool = clientOrPool ?? getPool();

  // 1. Verify board exists and actor has access
  const bRes = await pool.query<{
    id: string;
    project_id: string;
    workspace_id: string;
    structure_version: number;
    snapshot_version: number;
    timezone: string;
  }>(
    `SELECT b.id, b.project_id, b.workspace_id, b.structure_version, b.snapshot_version, w.timezone
     FROM boards b
     JOIN workspaces w ON w.id = b.workspace_id
     WHERE b.id = $1`,
    [boardId],
  );

  if (bRes.rows.length === 0 || !bRes.rows[0]) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }

  const bRow = bRes.rows[0];

  await requireBoardRead(pool, boardId, bRow.project_id, actorId);

  const asOfDate = getWorkspaceToday(bRow.timezone);
  const limit = Math.max(1, Math.min(query.limit ?? 50, 100));

  const currentFilterHash = computeCardFilterHash({
    columnId: query.columnId,
    query: query.query,
    priority: query.priority,
    assigneeId: query.assigneeId,
    due: query.due,
    asOfDate,
  });

  const filterClauses = buildCardFilterClauses(
    {
      columnId: query.columnId,
      titleQuery: query.query,
      priority: query.priority,
      assigneeId: query.assigneeId,
      due: query.due,
    },
    asOfDate,
    2,
  );

  const queryParams: unknown[] = [boardId, ...filterClauses.params];

  // 2. Decode cursor
  let cursorCondition = '';
  if (query.cursor) {
    const cursorPayload = decodeCardCursor(query.cursor);
    if (
      !cursorPayload ||
      cursorPayload.bId !== boardId ||
      cursorPayload.fH !== currentFilterHash ||
      cursorPayload.sV !== bRow.snapshot_version ||
      cursorPayload.oV !== bRow.structure_version
    ) {
      throw HttpError.conflict('Stale or malformed pagination cursor.', 'STALE_CURSOR');
    }

    const curPosIdx = queryParams.length + 1;
    const curIdIdx = queryParams.length + 2;
    cursorCondition = ` AND (c.position > $${curPosIdx} OR (c.position = $${curPosIdx} AND c.id > $${curIdIdx}))`;
    queryParams.push(cursorPayload.position, cursorPayload.id);
  }

  const limitParamIdx = queryParams.length + 1;
  queryParams.push(limit + 1);

  const sql = `
    SELECT
      c.id,
      c.board_id,
      c.column_id,
      c.title,
      c.priority,
      TO_CHAR(c.due_date, 'YYYY-MM-DD') AS due_date,
      c.position,
      c.version,
      c.created_at,
      c.updated_at,
      COALESCE(comm.comment_count, 0)::int AS comment_count,
      COALESCE(img.image_count, 0)::int AS image_count,
      COALESCE(assignees.user_ids, ARRAY[]::text[]) AS assignee_ids
    FROM cards c
    JOIN columns col ON col.id = c.column_id
    LEFT JOIN (
      SELECT card_id, COUNT(*)::int AS comment_count
      FROM comments
      WHERE deleted_at IS NULL
      GROUP BY card_id
    ) comm ON comm.card_id = c.id
    LEFT JOIN (
      SELECT card_id, COUNT(*)::int AS image_count
      FROM card_images
      GROUP BY card_id
    ) img ON img.card_id = c.id
    LEFT JOIN (
      SELECT card_id, ARRAY_AGG(user_id ORDER BY user_id ASC) AS user_ids
      FROM card_assignees
      GROUP BY card_id
    ) assignees ON assignees.card_id = c.id
    WHERE c.board_id = $1 AND c.state = 'active'
      ${filterClauses.sql}
      ${cursorCondition}
    ORDER BY c.position ASC, c.id ASC
    LIMIT $${limitParamIdx}
  `;

  const res = await pool.query<{
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
    comment_count: number;
    image_count: number;
    assignee_ids: string[];
  }>(sql, queryParams);

  const hasMore = res.rows.length > limit;
  const pageRows = hasMore ? res.rows.slice(0, limit) : res.rows;

  const cards: CardSummary[] = pageRows.map((c) => ({
    id: c.id,
    boardId: c.board_id,
    columnId: c.column_id,
    title: c.title,
    priority: c.priority,
    dueDate: c.due_date,
    assigneeIds: c.assignee_ids,
    position: Number(c.position),
    version: c.version,
    commentCount: c.comment_count,
    imageCount: c.image_count,
    createdAt: new Date(c.created_at).toISOString(),
    updatedAt: new Date(c.updated_at).toISOString(),
  }));

  const nextCursor =
    hasMore && pageRows.length > 0
      ? encodeCardCursor({
          boardId,
          filterHash: currentFilterHash,
          snapshotVersion: bRow.snapshot_version,
          structureVersion: bRow.structure_version,
          position: Number(pageRows[pageRows.length - 1]!.position),
          id: pageRows[pageRows.length - 1]!.id,
        })
      : null;

  return {
    data: cards,
    nextCursor,
  };
}
