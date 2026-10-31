import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import {
  type ImportStatus,
  type ImportRow,
  type ImportCounts,
  type ImportState,
  type ImportRowOutcome,
  type ImportRowError,
  type CommitImportInput,
  type UpdateImportMappingsInput,
  type Priority,
} from '@flowboard/contracts';
import { HttpError, validationError } from '../http/errors.ts';
import { acquireWriteGrantLock, acquireWritableProjectContextLock } from './rbac.ts';
import { lockBoardAccess } from './board-grants-foundation.ts';

async function lockImportBoard(client: pg.ClientBase, importId: string, actorId: string): Promise<void> {
  const context = await client.query<{ board_id: string }>(
    'SELECT board_id FROM card_imports WHERE id = $1', [importId],
  );
  if (!context.rows[0]) throw HttpError.notFound('Import session not found.', 'NOT_FOUND');
  await lockBoardAccess(client, context.rows[0].board_id, actorId);
}
import { recordActivity } from './activity.ts';
import { parseExcelWorkbook, type ParsedImportRow } from '../services/excel-parser.ts';

/**
 * Returns path to official Flowboard import template.
 */
export function getImportTemplatePath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx'),
    path.resolve(process.cwd(), '../outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx'),
    path.resolve(process.cwd(), '../../outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx'),
  ];
  try {
    const fromMeta = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../../outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx',
    );
    candidates.push(fromMeta);
  } catch {}
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return candidates[0]!;
}

function normalizeDueDate(d: unknown): string | null {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().split('T')[0]!;
  if (typeof d === 'string') return d.split('T')[0]!;
  return String(d);
}

/**
 * Computes deterministic SHA-256 row payload hash for duplicate & conflict comparison.
 */
export function computeRowHash(row: {
  externalId: string;
  title: string;
  description: string;
  priority: string;
  dueDate: unknown;
  assigneeEmails: string[];
  status: string | null;
}): string {
  const normalized = {
    externalId: row.externalId.normalize('NFC').trim(),
    title: row.title.trim(),
    description: row.description.trim(),
    priority: row.priority.toLowerCase().trim(),
    dueDate: normalizeDueDate(row.dueDate),
    assigneeEmails: [...row.assigneeEmails].map((e) => e.toLowerCase().trim()).sort(),
    status: row.status ? row.status.toLowerCase().trim() : null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Computes deterministic preview digest over import target, version, and row outcomes.
 */
export function computePreviewDigest(
  importId: string,
  boardId: string,
  defaultColumnId: string,
  version: number,
  rows: Array<{
    rowNumber: number;
    externalId: string;
    rowHash: string;
    outcome: ImportRowOutcome;
    status: string | null;
    assigneeIds: string[];
  }>,
): string {
  const digestPayload = {
    importId,
    boardId,
    defaultColumnId,
    version,
    rowCount: rows.length,
    rows: rows.map((r) => ({
      rowNumber: r.rowNumber,
      externalId: r.externalId,
      rowHash: r.rowHash,
      outcome: r.outcome,
      status: r.status,
      assigneeIds: r.assigneeIds,
    })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(digestPayload)).digest('hex');
}

export interface CreateCardImportParams {
  boardId: string;
  fileBuffer: Buffer;
  defaultColumnId: string;
  actorId: string;
}

interface DBImportRow {
  id: string;
  import_id: string;
  row_number: number;
  external_id: string;
  title: string;
  status: string | null;
  priority: string | null;
  due_date: Date | string | null;
  assignee_emails: string[] | null;
  outcome: string;
  errors: ImportRowError[] | null;
  card_id: string | null;
  created_at: Date | string;
}

interface DBImport {
  id: string;
  workspace_id: string;
  project_id: string;
  board_id: string;
  default_column_id: string;
  uploader_id: string;
  version: number;
  state: ImportState;
  preview_digest: string | null;
  expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * Creates an import session, parses Excel workbook, checks permissions, duplicates and conflicts,
 * and builds preview records.
 */
/**
 * Cheap, lock-free check that the actor may import to this board, run before the
 * workbook is parsed. It mirrors the order of acquireWriteGrantLock (missing board,
 * removed member, missing grant, viewer, non-manager) so a caller who would be refused
 * anyway never costs a ZIP inflation. It takes no row locks: the locked check below
 * still runs after parsing and is the revocation guard.
 */
async function assertImportAccessBeforeParse(
  client: pg.ClientBase,
  boardId: string,
  actorId: string,
): Promise<void> {
  const boardRes = await client.query<{ project_id: string; workspace_id: string; owner_id: string }>(
    `SELECT b.project_id, b.workspace_id, w.owner_id
     FROM boards b
     JOIN workspaces w ON w.id = b.workspace_id
     WHERE b.id = $1`,
    [boardId],
  );
  const board = boardRes.rows[0];
  if (!board) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }
  if (board.owner_id === actorId) {
    return;
  }

  const memberRes = await client.query<{ role: string; status: string }>(
    `SELECT role, status FROM project_memberships WHERE project_id = $1 AND user_id = $2`,
    [board.project_id, actorId],
  );
  const member = memberRes.rows[0];
  if (!member || member.status === 'removed') {
    throw HttpError.notFound('Project not found or access revoked.', 'NOT_FOUND');
  }

  const grantRes = await client.query<{ board_id: string }>(
    `SELECT board_id FROM board_grants
     WHERE board_id = $1 AND project_id = $2 AND workspace_id = $3 AND user_id = $4`,
    [boardId, board.project_id, board.workspace_id, actorId],
  );
  if (!grantRes.rows[0]) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }

  if (member.role === 'viewer') {
    throw HttpError.forbidden('Viewers cannot perform write operations.', 'FORBIDDEN');
  }
  if (member.role !== 'manager') {
    throw HttpError.forbidden('Only a manager or the owner can do this.', 'FORBIDDEN');
  }
}

export async function createCardImport(
  client: pg.PoolClient | pg.ClientBase,
  params: CreateCardImportParams,
): Promise<ImportStatus> {
  const { boardId, fileBuffer, defaultColumnId, actorId } = params;
  // Refuse unauthorised callers before any ZIP work, then parse before acquiring the
  // revocation guard so a large workbook cannot hold the membership and board-grant
  // locks while its ZIP is inspected.
  await assertImportAccessBeforeParse(client, boardId, actorId);
  const parseResult = parseExcelWorkbook(fileBuffer);

  // 1. Verify board existence and project context
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
     WHERE id = $1`,
    [boardId],
  );

  if (boardRes.rows.length === 0) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }

  const board = boardRes.rows[0]!;
  // 2. Authorize actor: Workspace Owner or Project Manager required!
  // Viewers/Members receive 403 FORBIDDEN; outsiders receive 404 NOT_FOUND.
  await acquireWriteGrantLock(client, board.project_id, actorId, 'manager', boardId);
  if (board.archived) {
    throw HttpError.conflict('BOARD_ARCHIVED', 'Board is archived.');
  }
  await acquireWritableProjectContextLock(client, board.project_id, boardId);

  // 3. Verify defaultColumnId belongs to this board
  const colRes = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM columns WHERE id = $1 AND board_id = $2`,
    [defaultColumnId, boardId],
  );
  if (colRes.rows.length === 0) {
    throw validationError('Default column not found on this board.', {
      issues: [{ path: 'defaultColumnId', message: 'Default column not found on this board.' }],
    });
  }

  // 4. Fetch all columns on this board for status matching
  const allColsRes = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM columns WHERE board_id = $1 ORDER BY position ASC`,
    [boardId],
  );
  const columnByName = new Map<string, string>();
  for (const c of allColsRes.rows) {
    columnByName.set(c.name.toLowerCase().trim(), c.id);
  }

  // 5. Fetch all eligible active project members & workspace owner for assignee email resolution
  const membersRes = await client.query<{ id: string; email: string }>(
    `SELECT u.id, lower(u.email) AS email
     FROM users u
     WHERE (
       u.id = (SELECT owner_id FROM workspaces WHERE id = $1)
       OR EXISTS (
         SELECT 1 FROM project_memberships pm
         WHERE pm.project_id = $2
           AND pm.user_id = u.id
           AND pm.status = 'active'
           AND pm.role IN ('owner', 'manager', 'member')
       )
     )`,
    [board.workspace_id, board.project_id],
  );
  const emailToUserId = new Map<string, string>();
  for (const m of membersRes.rows) {
    emailToUserId.set(m.email.toLowerCase().trim(), m.id);
  }

  // 6. Fetch existing duplicate markers from card_import_duplicates
  const dupesRes = await client.query<{ external_id: string; row_hash: string; card_id: string | null }>(
    `SELECT external_id, row_hash, card_id
     FROM card_import_duplicates
     WHERE board_id = $1`,
    [boardId],
  );
  const existingDupes = new Map<string, { rowHash: string; cardId: string | null }>();
  for (const d of dupesRes.rows) {
    existingDupes.set(d.external_id, { rowHash: d.row_hash, cardId: d.card_id });
  }

  // 7. Process rows and determine outcomes
  const importId = 'imp_' + crypto.randomUUID();
  const seenBatchExternalIds = new Set<string>();

  interface ProcessedRow {
    id: string;
    rowNumber: number;
    externalId: string;
    title: string;
    status: string | null;
    priority: Priority;
    dueDate: string | null;
    assigneeEmails: string[];
    assigneeIds: string[];
    outcome: ImportRowOutcome;
    errors: ImportRowError[];
    cardId: string | null;
    rowHash: string;
  }

  const processedRows: ProcessedRow[] = [];
  let invalidCount = 0;
  let conflictCount = 0;
  let newCount = 0;
  let existingCount = 0;

  for (const parsed of parseResult.rows) {
    const rowId = 'impr_' + crypto.randomUUID();
    const errors: ImportRowError[] = [...parsed.rawErrors];

    // Deduplicate within the batch itself
    if (seenBatchExternalIds.has(parsed.externalId)) {
      errors.push({
        field: 'externalId',
        code: 'DUPLICATE_IN_BATCH',
        message: `External ID '${parsed.externalId}' is repeated in this workbook.`,
      });
    } else {
      seenBatchExternalIds.add(parsed.externalId);
    }

    // Resolve assignees
    const resolvedAssigneeIds: string[] = [];
    for (const email of parsed.assigneeEmails) {
      const uid = emailToUserId.get(email.toLowerCase().trim());
      if (uid) {
        resolvedAssigneeIds.push(uid);
      } else {
        errors.push({
          field: 'assigneeEmails',
          code: 'UNKNOWN_OR_INELIGIBLE_ASSIGNEE',
          message: `Assignee email '${email}' is not an active member of this project.`,
        });
      }
    }

    // Resolve status / column
    let targetColumnId: string | null = null;
    if (parsed.status) {
      const colId = columnByName.get(parsed.status.toLowerCase().trim());
      if (colId) {
        targetColumnId = colId;
      } else {
        errors.push({
          field: 'status',
          code: 'UNRECOGNIZED_STATUS',
          message: `Status '${parsed.status}' does not match any column on this board.`,
        });
      }
    } else {
      targetColumnId = defaultColumnId;
    }

    // Compute row hash
    const rowHash = computeRowHash({
      externalId: parsed.externalId,
      title: parsed.title,
      description: parsed.description,
      priority: parsed.priority,
      dueDate: parsed.dueDate,
      assigneeEmails: parsed.assigneeEmails,
      status: parsed.status,
    });

    // Check duplicate markers
    let outcome: ImportRowOutcome = 'new';
    let cardId: string | null = null;

    const existingDupe = existingDupes.get(parsed.externalId);
    if (existingDupe) {
      if (existingDupe.rowHash === rowHash) {
        outcome = 'already_imported';
        cardId = existingDupe.cardId;
        existingCount++;
      } else {
        outcome = 'conflict';
        conflictCount++;
        errors.push({
          field: 'externalId',
          code: 'IMPORT_CONFLICT',
          message: `External ID '${parsed.externalId}' was previously imported with different content. Changing an imported row is a conflict.`,
        });
      }
    } else if (errors.length > 0) {
      outcome = 'invalid';
      invalidCount++;
    } else {
      outcome = 'new';
      newCount++;
    }

    processedRows.push({
      id: rowId,
      rowNumber: parsed.rowNumber,
      externalId: parsed.externalId,
      title: parsed.title,
      status: parsed.status,
      priority: parsed.priority,
      dueDate: parsed.dueDate,
      assigneeEmails: parsed.assigneeEmails,
      assigneeIds: resolvedAssigneeIds,
      outcome,
      errors,
      cardId,
      rowHash,
    });
  }

  // 9. State and Preview Digest
  const importState: ImportState = invalidCount > 0 || conflictCount > 0 ? 'invalid' : 'ready';
  const previewDigest = computePreviewDigest(
    importId,
    boardId,
    defaultColumnId,
    1,
    processedRows.map((r) => ({
      rowNumber: r.rowNumber,
      externalId: r.externalId,
      rowHash: r.rowHash,
      outcome: r.outcome,
      status: r.status,
      assigneeIds: r.assigneeIds,
    })),
  );

  // 10. Insert into card_imports
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes preview TTL

  await client.query(
    `INSERT INTO card_imports (
       id, workspace_id, project_id, board_id, default_column_id,
       uploader_id, version, state, preview_digest, expires_at,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, 1, $7, $8, $9,
       NOW(), NOW()
     )`,
    [
      importId,
      board.workspace_id,
      board.project_id,
      boardId,
      defaultColumnId,
      actorId,
      importState,
      previewDigest,
      expiresAt.toISOString(),
    ],
  );

  // 11. Insert rows into card_import_rows
  for (const r of processedRows) {
    await client.query(
      `INSERT INTO card_import_rows (
         id, import_id, row_number, external_id, title, status,
         priority, due_date, assignee_emails, outcome, errors,
         card_id, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10, $11,
         $12, NOW()
       )`,
      [
        r.id,
        importId,
        r.rowNumber,
        r.externalId,
        r.title,
        r.status,
        r.priority,
        r.dueDate,
        r.assigneeEmails.length > 0 ? r.assigneeEmails : null,
        r.outcome,
        r.errors.length > 0 ? JSON.stringify(r.errors) : null,
        r.cardId,
      ],
    );
  }

  const counts: ImportCounts = {
    total: processedRows.length,
    new: newCount,
    existing: existingCount,
    invalid: invalidCount,
    conflict: conflictCount,
    created: 0,
    skipped: 0,
  };

  return {
    id: importId,
    projectId: board.project_id,
    boardId,
    defaultColumnId,
    version: 1,
    state: importState,
    previewDigest,
    expiresAt: expiresAt.toISOString(),
    serverNow: new Date().toISOString(),
    counts,
    canCommit: importState === 'ready' && invalidCount === 0 && conflictCount === 0,
    cancellationAllowed: true,
    rows: processedRows.map((r) => ({
      rowNumber: r.rowNumber,
      externalId: r.externalId,
      title: r.title,
      status: r.status,
      priority: r.priority,
      dueDate: r.dueDate,
      assigneeIds: r.assigneeIds,
      outcome: r.outcome,
      errors: r.errors,
      cardId: r.cardId,
    })),
    nextCursor: null,
    error: null,
  };
}

/**
 * Retrieves import status, inspecting counts, preview rows, and expiration.
 */
export async function getCardImportStatus(
  client: pg.PoolClient | pg.ClientBase,
  importId: string,
  actorId: string,
  pagination?: { limit?: number | undefined; cursor?: string | undefined } | undefined,
): Promise<ImportStatus> {
  const importRes = await client.query<DBImport>(
    `SELECT id, workspace_id, project_id, board_id, default_column_id,
            uploader_id, version, state, preview_digest, expires_at,
            created_at, updated_at
     FROM card_imports
     WHERE id = $1`,
    [importId],
  );

  if (importRes.rows.length === 0) {
    throw HttpError.notFound('Import session not found.', 'NOT_FOUND');
  }

  const imp = importRes.rows[0]!;

  // Role check: Owner or Manager
  await acquireWriteGrantLock(client, imp.project_id, actorId, 'manager', imp.board_id);

  // Check TTL expiry
  let currentState: ImportState = imp.state;
  const now = new Date();
  if (
    imp.expires_at &&
    new Date(imp.expires_at) < now &&
    ['uploaded', 'validating', 'ready', 'invalid'].includes(currentState)
  ) {
    currentState = 'expired';
    await client.query(
      `UPDATE card_imports SET state = 'expired', updated_at = NOW() WHERE id = $1`,
      [importId],
    );
  }

  // Fetch counts
  const countsRes = await client.query<{
    outcome: ImportRowOutcome;
    count: string;
  }>(
    `SELECT outcome, COUNT(*)::TEXT AS count
     FROM card_import_rows
     WHERE import_id = $1
     GROUP BY outcome`,
    [importId],
  );

  let newCount = 0;
  let existingCount = 0;
  let invalidCount = 0;
  let conflictCount = 0;
  let createdCount = 0;
  let skippedCount = 0;

  for (const c of countsRes.rows) {
    const n = parseInt(c.count, 10);
    switch (c.outcome) {
      case 'new':
        newCount += n;
        break;
      case 'already_imported':
        existingCount += n;
        break;
      case 'invalid':
        invalidCount += n;
        break;
      case 'conflict':
        conflictCount += n;
        break;
      case 'created':
        createdCount += n;
        break;
      case 'skipped':
        skippedCount += n;
        break;
    }
  }

  const total = newCount + existingCount + invalidCount + conflictCount + createdCount + skippedCount;
  const counts: ImportCounts = {
    total,
    new: newCount,
    existing: existingCount,
    invalid: invalidCount,
    conflict: conflictCount,
    created: createdCount,
    skipped: skippedCount,
  };

  // Fetch paginated rows
  const limit = Math.min(Math.max(pagination?.limit ?? 50, 1), 200);
  const cursorRow = pagination?.cursor ? parseInt(pagination.cursor, 10) : 0;

  const rowsRes = await client.query<DBImportRow>(
    `SELECT id, import_id, row_number, external_id, title, status,
            priority, to_char(due_date, 'YYYY-MM-DD') AS due_date,
            assignee_emails, outcome, errors, card_id, created_at
     FROM card_import_rows
     WHERE import_id = $1 AND row_number > $2
     ORDER BY row_number ASC
     LIMIT $3`,
    [importId, cursorRow, limit + 1],
  );

  const hasMore = rowsRes.rows.length > limit;
  const displayRows = hasMore ? rowsRes.rows.slice(0, limit) : rowsRes.rows;
  const nextCursor = hasMore && displayRows.length > 0 ? String(displayRows[displayRows.length - 1]!.row_number) : null;

  // Resolve assignee IDs for display rows
  const allEmails = new Set<string>();
  for (const r of displayRows) {
    if (r.assignee_emails) {
      for (const e of r.assignee_emails) allEmails.add(e.toLowerCase().trim());
    }
  }

  const emailToIdMap = new Map<string, string>();
  if (allEmails.size > 0) {
    const userRes = await client.query<{ id: string; email: string }>(
      `SELECT id, lower(email) AS email FROM users WHERE lower(email) = ANY($1::TEXT[])`,
      [Array.from(allEmails)],
    );
    for (const u of userRes.rows) {
      emailToIdMap.set(u.email, u.id);
    }
  }

  const rows: ImportRow[] = displayRows.map((r) => {
    const assigneeIds = (r.assignee_emails ?? [])
      .map((e) => emailToIdMap.get(e.toLowerCase().trim()))
      .filter((id): id is string => Boolean(id));

    return {
      rowNumber: r.row_number,
      externalId: r.external_id,
      title: r.title,
      status: r.status,
      priority: (r.priority as Priority) ?? 'none',
      dueDate: (r.due_date as string) ?? null,
      assigneeIds,
      outcome: r.outcome as ImportRowOutcome,
      errors: (r.errors as ImportRowError[]) ?? [],
      cardId: r.card_id,
    };
  });

  const canCommit = currentState === 'ready' && invalidCount === 0 && conflictCount === 0;
  const cancellationAllowed = ['uploaded', 'validating', 'ready', 'invalid'].includes(currentState);

  return {
    id: imp.id,
    projectId: imp.project_id,
    boardId: imp.board_id,
    defaultColumnId: imp.default_column_id,
    version: imp.version,
    state: currentState,
    previewDigest: imp.preview_digest,
    expiresAt: imp.expires_at ? new Date(imp.expires_at).toISOString() : null,
    serverNow: new Date().toISOString(),
    counts,
    canCommit,
    cancellationAllowed,
    rows,
    nextCursor,
    error: null,
  };
}

/**
 * Updates status mappings, revalidating preview and incrementing version.
 */
export async function updateImportMappings(
  client: pg.PoolClient | pg.ClientBase,
  importId: string,
  actorId: string,
  input: UpdateImportMappingsInput,
): Promise<ImportStatus> {
  await lockImportBoard(client, importId, actorId);
  const importRes = await client.query<DBImport>(
    `SELECT id, workspace_id, project_id, board_id, default_column_id,
            version, state, preview_digest, expires_at
     FROM card_imports
     WHERE id = $1
     FOR UPDATE`,
    [importId],
  );

  if (importRes.rows.length === 0) {
    throw HttpError.notFound('Import session not found.', 'NOT_FOUND');
  }

  const imp = importRes.rows[0]!;
  await acquireWriteGrantLock(client, imp.project_id, actorId, 'manager', imp.board_id);

  if (['committed', 'committing', 'expired', 'cancelled'].includes(imp.state)) {
    throw HttpError.conflict('INVALID_STATE', `Cannot update mappings in state '${imp.state}'.`);
  }

  if (imp.version !== input.expectedVersion) {
    throw HttpError.conflict('STALE_VERSION', 'Stale import version.');
  }

  // Verify mapped columns belong to this board
  const boardColsRes = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM columns WHERE board_id = $1`,
    [imp.board_id],
  );
  const validColIds = new Set(boardColsRes.rows.map((c) => c.id));
  const colById = new Map(boardColsRes.rows.map((c) => [c.id, c.name]));

  for (const [statusName, targetColId] of Object.entries(input.mappings)) {
    if (!validColIds.has(targetColId)) {
      throw validationError(`Target column ID '${targetColId}' does not belong to this board.`, {
        issues: [{ path: 'mappings', message: `Target column '${targetColId}' does not belong to this board.` }],
      });
    }
  }

  // Update rows that have matching status
  const rowsRes = await client.query<DBImportRow>(
    `SELECT * FROM card_import_rows WHERE import_id = $1 ORDER BY row_number ASC FOR UPDATE`,
    [importId],
  );

  let invalidCount = 0;
  let conflictCount = 0;
  let newCount = 0;
  let existingCount = 0;

  for (const r of rowsRes.rows) {
    let outcome = r.outcome as ImportRowOutcome;
    let errors = (r.errors as ImportRowError[]) ?? [];
    let updatedStatus = r.status;

    if (r.status && input.mappings[r.status]) {
      const targetColId = input.mappings[r.status]!;
      const colName = colById.get(targetColId);
      if (colName) {
        updatedStatus = colName;
      }
      // Clear previous status error if present
      errors = errors.filter((e) => e.code !== 'UNRECOGNIZED_STATUS');
      if (outcome === 'invalid' && errors.length === 0) {
        outcome = 'new';
      }
    }

    if (outcome === 'invalid') invalidCount++;
    else if (outcome === 'conflict') conflictCount++;
    else if (outcome === 'new') newCount++;
    else if (outcome === 'already_imported') existingCount++;

    await client.query(
      `UPDATE card_import_rows SET status = $1, outcome = $2, errors = $3 WHERE id = $4`,
      [updatedStatus, outcome, errors.length > 0 ? JSON.stringify(errors) : null, r.id],
    );
  }

  const nextVersion = imp.version + 1;
  const nextState: ImportState = invalidCount > 0 || conflictCount > 0 ? 'invalid' : 'ready';

  const updatedRowsRes = await client.query<DBImportRow>(
    `SELECT * FROM card_import_rows WHERE import_id = $1 ORDER BY row_number ASC`,
    [importId],
  );

  const previewDigest = computePreviewDigest(
    importId,
    imp.board_id,
    imp.default_column_id,
    nextVersion,
    updatedRowsRes.rows.map((r) => ({
      rowNumber: r.row_number,
      externalId: r.external_id,
      rowHash: r.id, // placeholder
      outcome: r.outcome as ImportRowOutcome,
      status: r.status,
      assigneeIds: [],
    })),
  );

  await client.query(
    `UPDATE card_imports
     SET version = $1, state = $2, preview_digest = $3, updated_at = NOW()
     WHERE id = $4`,
    [nextVersion, nextState, previewDigest, importId],
  );

  return getCardImportStatus(client, importId, actorId);
}

/**
 * Commits card import in one atomic bounded PostgreSQL transaction.
 */
export async function commitCardImport(
  client: pg.PoolClient | pg.ClientBase,
  importId: string,
  actorId: string,
  input: CommitImportInput,
): Promise<ImportStatus> {
  await lockImportBoard(client, importId, actorId);
  // 1. Lock and fetch import session
  const importRes = await client.query<DBImport>(
    `SELECT id, workspace_id, project_id, board_id, default_column_id,
            uploader_id, version, state, preview_digest, expires_at
     FROM card_imports
     WHERE id = $1
     FOR UPDATE`,
    [importId],
  );

  if (importRes.rows.length === 0) {
    throw HttpError.notFound('Import session not found.', 'NOT_FOUND');
  }

  const imp = importRes.rows[0]!;

  // 2. Re-verify project permissions: Owner or Manager required!
  await acquireWriteGrantLock(client, imp.project_id, actorId, 'manager', imp.board_id);
  await acquireWritableProjectContextLock(client, imp.project_id, imp.board_id);

  // 3. Lost response / replay detection
  if (imp.state === 'committed') {
    return getCardImportStatus(client, importId, actorId);
  }

  if (imp.state === 'committing') {
    throw HttpError.conflict('COMMIT_IN_PROGRESS', 'Import commit is currently in progress.');
  }

  // 4. Verify preview expiration
  if (imp.expires_at && new Date(imp.expires_at) < new Date()) {
    await client.query(
      `UPDATE card_imports SET state = 'expired', updated_at = NOW() WHERE id = $1`,
      [importId],
    );
    throw new HttpError(410, 'PREVIEW_EXPIRED', 'This preview has expired. Upload the file again to preview it.');
  }

  if (imp.state !== 'ready') {
    throw HttpError.conflict('INVALID_STATE', `Cannot commit import in state '${imp.state}'.`);
  }

  // 5. OCC Version and Preview Digest validation
  if (imp.version !== input.expectedVersion) {
    throw HttpError.conflict('STALE_VERSION', 'This import changed since you previewed it. Preview it again before confirming.', {
      expectedVersion: input.expectedVersion,
      currentVersion: imp.version,
    });
  }

  if (imp.preview_digest !== input.previewDigest) {
    throw HttpError.conflict(
      'PREVIEW_STALE',
      'Preview digest mismatch. The import configuration has changed and requires revalidation.',
      {
        expectedDigest: input.previewDigest,
        currentDigest: imp.preview_digest,
      },
    );
  }

  // 6. Lock and verify board
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
    [imp.board_id],
  );

  if (boardRes.rows.length === 0) {
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }

  const board = boardRes.rows[0]!;
  if (board.archived) {
    throw HttpError.conflict('BOARD_ARCHIVED', 'Board is archived.');
  }

  // Verify target default column
  const targetColId = input.defaultColumnId || imp.default_column_id;
  const colRes = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM columns WHERE id = $1 AND board_id = $2`,
    [targetColId, imp.board_id],
  );
  if (colRes.rows.length === 0) {
    throw validationError('Target default column not found on this board.', {
      issues: [{ path: 'defaultColumnId', message: 'Target default column not found.' }],
    });
  }

  // Fetch all board columns
  const allColsRes = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM columns WHERE board_id = $1`,
    [imp.board_id],
  );
  const colByName = new Map<string, string>();
  for (const c of allColsRes.rows) {
    colByName.set(c.name.toLowerCase().trim(), c.id);
  }

  // 7. Lock and fetch all rows for this import
  const rowsRes = await client.query<DBImportRow>(
    `SELECT id, import_id, row_number, external_id, title, status,
            priority, to_char(due_date, 'YYYY-MM-DD') AS due_date,
            assignee_emails, outcome, errors, card_id, created_at
     FROM card_import_rows
     WHERE import_id = $1
     ORDER BY row_number ASC
     FOR UPDATE`,
    [importId],
  );

  // 8. Re-verify: Zero invalid or conflict rows allowed!
  const hasInvalidOrConflict = rowsRes.rows.some((r) => r.outcome === 'invalid' || r.outcome === 'conflict');
  if (hasInvalidOrConflict) {
    throw HttpError.unprocessable(
      'IMPORT_HAS_ERRORS',
      'Cannot commit an import containing invalid or conflicting rows. Fix errors and re-upload.',
    );
  }

  // 9. Re-verify assignee eligibility across all new rows
  const allEmails = new Set<string>();
  for (const r of rowsRes.rows) {
    if (r.outcome === 'new' && r.assignee_emails) {
      for (const e of r.assignee_emails) allEmails.add(e.toLowerCase().trim());
    }
  }

  const emailToUserMap = new Map<string, string>();
  if (allEmails.size > 0) {
    const verifiedUsersRes = await client.query<{ id: string; email: string }>(
      `SELECT u.id, lower(u.email) AS email
       FROM users u
       WHERE lower(u.email) = ANY($1::TEXT[])
         AND (
           u.id = (SELECT owner_id FROM workspaces WHERE id = $2)
           OR EXISTS (
             SELECT 1 FROM project_memberships pm
             WHERE pm.project_id = $3
               AND pm.user_id = u.id
               AND pm.status = 'active'
               AND pm.role IN ('owner', 'manager', 'member')
           )
         )`,
      [Array.from(allEmails), imp.workspace_id, imp.project_id],
    );

    for (const u of verifiedUsersRes.rows) {
      emailToUserMap.set(u.email, u.id);
    }

    // Check if any email from preview became ineligible or was removed
    for (const email of allEmails) {
      if (!emailToUserMap.has(email)) {
        throw HttpError.conflict(
          'PREVIEW_STALE',
          `Assignee membership for '${email}' changed or was revoked since preview generation. Revalidation required.`,
        );
      }
    }
  }

  // 10. Atomically transition state to 'committing'
  await client.query(
    `UPDATE card_imports SET state = 'committing', updated_at = NOW() WHERE id = $1`,
    [importId],
  );

  // 11. Prepare position allocator per column
  const posByColumn = new Map<string, number>();
  for (const col of allColsRes.rows) {
    const maxPosRes = await client.query<{ max_pos: string | null }>(
      `SELECT COALESCE(MAX(position), 0)::TEXT AS max_pos
       FROM cards
       WHERE column_id = $1 AND state = 'active'`,
      [col.id],
    );
    posByColumn.set(col.id, parseInt(maxPosRes.rows[0]?.max_pos ?? '0', 10));
  }

  let createdCount = 0;
  let skippedCount = 0;

  // 12. Create all new cards
  for (const r of rowsRes.rows) {
    if (r.outcome === 'already_imported') {
      await client.query(
        `UPDATE card_import_rows SET outcome = 'skipped' WHERE id = $1`,
        [r.id],
      );
      skippedCount++;
      continue;
    }

    if (r.outcome !== 'new') {
      continue;
    }

    // Determine target column
    let destColId = targetColId;
    if (r.status) {
      const mapped = colByName.get(r.status.toLowerCase().trim());
      if (mapped) {
        destColId = mapped;
      } else if (allColsRes.rows.some((c) => c.id === r.status)) {
        destColId = r.status;
      }
    }

    // Allocate next position
    const currentPos = posByColumn.get(destColId) ?? 0;
    const nextPos = currentPos + 1000;
    posByColumn.set(destColId, nextPos);

    // Create Card
    const cardId = 'crd_' + crypto.randomUUID();
    const priority = (r.priority as Priority) ?? 'none';
    const dueDate = r.due_date ?? null;

    await client.query(
      `INSERT INTO cards (
         id, workspace_id, project_id, board_id, column_id,
         title, description, priority, due_date, position,
         version, state, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, '', $7, $8, $9,
         1, 'active', NOW(), NOW()
       )`,
      [
        cardId,
        imp.workspace_id,
        imp.project_id,
        imp.board_id,
        destColId,
        r.title,
        priority,
        dueDate,
        nextPos,
      ],
    );

    // Assignees
    if (r.assignee_emails && r.assignee_emails.length > 0) {
      for (const email of r.assignee_emails) {
        const uid = emailToUserMap.get(email.toLowerCase().trim());
        if (uid) {
          await client.query(
            `INSERT INTO card_assignees (card_id, user_id, workspace_id, project_id, created_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT DO NOTHING`,
            [cardId, uid, imp.workspace_id, imp.project_id],
          );
        }
      }
    }

    // Record duplicate marker in card_import_duplicates
    const rowHash = computeRowHash({
      externalId: r.external_id,
      title: r.title,
      description: '',
      priority: r.priority ?? 'none',
      dueDate: (r.due_date as string) ?? null,
      assigneeEmails: r.assignee_emails ?? [],
      status: r.status,
    });

    await client.query(
      `INSERT INTO card_import_duplicates (
         workspace_id, project_id, board_id, external_id,
         card_id, row_hash, created_at
       ) VALUES (
         $1, $2, $3, $4,
         $5, $6, NOW()
       )
       ON CONFLICT (board_id, external_id) DO NOTHING`,
      [imp.workspace_id, imp.project_id, imp.board_id, r.external_id, cardId, rowHash],
    );

    // Update row outcome to 'created'
    await client.query(
      `UPDATE card_import_rows SET outcome = 'created', card_id = $1 WHERE id = $2`,
      [cardId, r.id],
    );

    // Record card_created activity event
    await recordActivity(client, {
      workspaceId: imp.workspace_id,
      projectId: imp.project_id,
      boardId: imp.board_id,
      cardId,
      actorId,
      action: 'card_created',
      safeChanges: {
        source: 'excel_import',
        importId,
        externalId: r.external_id,
        rowNumber: r.row_number,
        title: r.title,
      },
    });

    createdCount++;
  }

  // 13. Record batch import activity log event
  await recordActivity(client, {
    workspaceId: imp.workspace_id,
    projectId: imp.project_id,
    boardId: imp.board_id,
    actorId,
    action: 'card_import_committed',
    safeChanges: {
      importId,
      createdCount,
      skippedCount,
    },
    visibilityScope: 'board',
  });

  // 14. Bump board snapshot_version and structure_version
  await client.query(
    `UPDATE boards
     SET structure_version = structure_version + 1,
         snapshot_version = snapshot_version + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [imp.board_id],
  );

  // 15. Transition import to 'committed'
  await client.query(
    `UPDATE card_imports
     SET state = 'committed', version = version + 1, updated_at = NOW()
     WHERE id = $1`,
    [importId],
  );

  return getCardImportStatus(client, importId, actorId);
}

/**
 * Cancels an import session before commit.
 */
export async function cancelCardImport(
  client: pg.PoolClient | pg.ClientBase,
  importId: string,
  actorId: string,
): Promise<{ id: string; state: 'cancelled' }> {
  await lockImportBoard(client, importId, actorId);
  const importRes = await client.query<DBImport>(
    `SELECT id, project_id, board_id, state
     FROM card_imports
     WHERE id = $1
     FOR UPDATE`,
    [importId],
  );

  if (importRes.rows.length === 0) {
    throw HttpError.notFound('Import session not found.', 'NOT_FOUND');
  }

  const imp = importRes.rows[0]!;
  await acquireWriteGrantLock(client, imp.project_id, actorId, 'manager', imp.board_id);

  if (imp.state === 'committing' || imp.state === 'committed') {
    throw HttpError.conflict(
      'COMMIT_IN_PROGRESS',
      'Cannot cancel an import that has already committed or is currently committing.',
    );
  }

  if (imp.state === 'cancelled') {
    return { id: imp.id, state: 'cancelled' };
  }

  await client.query(
    `UPDATE card_imports SET state = 'cancelled', updated_at = NOW() WHERE id = $1`,
    [importId],
  );

  return { id: imp.id, state: 'cancelled' };
}

/**
 * Generates safe CSV report of import row outcomes with formula injection protection.
 */
export async function getImportReport(
  client: pg.PoolClient | pg.ClientBase,
  importId: string,
  actorId: string,
): Promise<string> {
  const importRes = await client.query<DBImport>(
    `SELECT id, project_id, board_id FROM card_imports WHERE id = $1`,
    [importId],
  );

  if (importRes.rows.length === 0) {
    throw HttpError.notFound('Import session not found.', 'NOT_FOUND');
  }

  const imp = importRes.rows[0]!;
  await acquireWriteGrantLock(client, imp.project_id, actorId, 'manager', imp.board_id);

  const rowsRes = await client.query<DBImportRow>(
    `SELECT row_number, external_id, title, status, priority,
            to_char(due_date, 'YYYY-MM-DD') AS due_date,
            outcome, errors, card_id
     FROM card_import_rows
     WHERE import_id = $1
     ORDER BY row_number ASC`,
    [importId],
  );

  // CSV escape with formula injection defense
  function escapeCsvCell(val: unknown): string {
    if (val === null || val === undefined) return '';
    let str = String(val);
    // Neutralize formula injection: if cell starts with =, +, -, @, \t, \r, prepend single quote
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  const header = ['Row', 'External ID', 'Title', 'Status', 'Priority', 'Due Date', 'Outcome', 'Errors', 'Card ID'];
  const lines = [header.join(',')];

  for (const r of rowsRes.rows) {
    const errText = r.errors && r.errors.length > 0 ? (r.errors as ImportRowError[]).map((e) => e.message).join('; ') : '';
    const line = [
      escapeCsvCell(r.row_number),
      escapeCsvCell(r.external_id),
      escapeCsvCell(r.title),
      escapeCsvCell(r.status ?? ''),
      escapeCsvCell(r.priority ?? 'none'),
      escapeCsvCell(r.due_date ?? ''),
      escapeCsvCell(r.outcome),
      escapeCsvCell(errText),
      escapeCsvCell(r.card_id ?? ''),
    ];
    lines.push(line.join(','));
  }

  return lines.join('\n');
}
