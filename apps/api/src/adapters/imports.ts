import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { type ImportStatus, type ImportRow, type ImportCounts, type ImportState, type ImportRowOutcome, type ImportRowError, type CommitImportInput, type UpdateImportMappingsInput, type Priority } from '@flowboard/contracts';
import { HttpError, validationError } from '../http/errors.ts';
import { acquireWriteGrantLock, acquireWritableProjectContextLock, getHistoricalPersonDisplay } from './rbac.ts';
import { lockBoardAccess } from './board-grants-foundation.ts';
async function lockImportBoard(client: pg.ClientBase, importId: string, actorId: string): Promise<void> {
  const context = await client.query<{
    board_id: string;
  }>('SELECT board_id FROM card_imports WHERE id = $1', [importId]);
  if (!context.rows[0]) throw HttpError.notFound('Import session not found.', 'NOT_FOUND');
  await lockBoardAccess(client, context.rows[0].board_id, actorId);
}
import { recordActivity } from './activity.ts';
import { redactImportRows } from '../services/import-retention.ts';
import { parseExcelWorkbook, type ParsedImportRow } from '../services/excel-parser.ts';

/**
 * Returns path to official Flowboard import template.
 */
export function getImportTemplatePath(): string {
  const candidates = [path.resolve(process.cwd(), 'outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx'), path.resolve(process.cwd(), '../outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx'), path.resolve(process.cwd(), '../../outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx')];
  try {
    const fromMeta = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../outputs/01a1746d-a7e8-7e32-aac2-f9fe748b853d/Flowboard_Card_Import_Template.xlsx');
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
    description: row.description,
    priority: row.priority.toLowerCase().trim(),
    dueDate: normalizeDueDate(row.dueDate),
    assigneeEmails: [...row.assigneeEmails].map(e => e.toLowerCase().trim()).sort(),
    status: row.status ? row.status.toLowerCase().trim() : null
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * Computes deterministic preview digest over import target, version, and row outcomes.
 */
export function computePreviewDigest(importId: string, boardId: string, defaultColumnId: string, version: number, rows: Array<{
  rowNumber: number;
  externalId: string;
  rowHash: string;
  outcome: ImportRowOutcome;
  status: string | null;
  assigneeIds: string[];
  targetColumnId?: string | null;
}>, context?: {
  actorId: string;
  structureVersion: number;
}): string {
  const digestPayload = {
    importId,
    boardId,
    defaultColumnId,
    version,
    context,
    rowCount: rows.length,
    rows: rows.map(r => ({
      rowNumber: r.rowNumber,
      externalId: r.externalId,
      rowHash: r.rowHash,
      outcome: r.outcome,
      status: r.status,
      assigneeIds: [...r.assigneeIds].sort(),
      targetColumnId: r.targetColumnId ?? null
    }))
  };
  return crypto.createHash('sha256').update(JSON.stringify(digestPayload)).digest('hex');
}
export interface CreateCardImportParams {
  boardId: string;
  fileBuffer: Buffer;
  defaultColumnId: string;
  actorId: string;
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
  board_structure_version: number | null;
  content_cleaned_at: Date | string | null;
  created_at: Date | string;
}
interface DBImportRow {
  id: string;
  import_id: string;
  row_number: number;
  external_id: string;
  title: string;
  description: string | null;
  status: string | null;
  source_status: string | null;
  priority: string | null;
  due_date: string | Date | null;
  assignee_emails: string[] | null;
  assignee_ids: string[] | null;
  target_column_id: string | null;
  row_hash: string | null;
  outcome: ImportRowOutcome;
  errors: ImportRowError[] | null;
  card_id: string | null;
}
const activePreviewStates = ['uploaded', 'validating', 'ready', 'invalid'];
async function assertImportAccessBeforeParse(client: pg.ClientBase, boardId: string, actorId: string): Promise<void> {
  const access = await client.query<{
    owner_id: string;
    role: string | null;
    status: string | null;
    granted: boolean;
  }>(`SELECT w.owner_id,pm.role,pm.status,EXISTS(SELECT 1 FROM board_grants bg
       WHERE bg.board_id=b.id AND bg.project_id=b.project_id AND bg.user_id=$2) AS granted
     FROM boards b JOIN projects p ON p.id=b.project_id JOIN workspaces w ON w.id=p.workspace_id
     LEFT JOIN project_memberships pm ON pm.project_id=p.id AND pm.user_id=$2 WHERE b.id=$1`, [boardId, actorId]);
  const a = access.rows[0];
  if (!a || a.owner_id !== actorId && (a.status !== 'active' || !a.granted)) throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  if (a.owner_id !== actorId && a.role !== 'manager') throw HttpError.forbidden('Only a manager or the owner can do this.', 'FORBIDDEN');
}

/** Lock eligible recipient membership/grants in stable user order BEFORE the board ordering row.
 * Membership removal and board-grant administration lock these same rows first.
 */
async function lockEligibleAssignees(client: pg.ClientBase, projectId: string, boardId: string, emails: string[]): Promise<Map<string, string>> {
  const scope = await client.query<{
    owner_id: string;
  }>('SELECT w.owner_id FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE p.id=$1 FOR SHARE OF w', [projectId]);
  const ownerId = scope.rows[0]?.owner_id;
  const people = await client.query<{
    id: string;
    email: string;
  }>('SELECT id,lower(email) AS email FROM users WHERE lower(email)=ANY($1::text[]) ORDER BY id', [emails]);
  const ids = people.rows.filter(p => p.id !== ownerId).map(p => p.id);
  const members = await client.query<{
    user_id: string;
    role: string;
    status: string;
  }>(`SELECT user_id,role,status FROM project_memberships WHERE project_id=$1 AND user_id=ANY($2::text[])
     ORDER BY user_id FOR SHARE`, [projectId, ids]);
  const grants = await client.query<{
    user_id: string;
  }>(`SELECT user_id FROM board_grants WHERE project_id=$1 AND board_id=$2 AND user_id=ANY($3::text[])
     ORDER BY user_id FOR SHARE`, [projectId, boardId, ids]);
  const writable = new Set(members.rows.filter(m => m.status === 'active' && ['member', 'manager'].includes(m.role)).map(m => m.user_id));
  const granted = new Set(grants.rows.map(g => g.user_id));
  return new Map(people.rows.filter(p => p.id === ownerId || writable.has(p.id) && granted.has(p.id)).map(p => [p.email, p.id]));
}
function digestFor(imp: DBImport, rows: DBImportRow[]): string {
  return computePreviewDigest(imp.id, imp.board_id, imp.default_column_id, imp.version, rows.map(r => ({
    rowNumber: r.row_number,
    externalId: r.external_id,
    rowHash: r.row_hash ?? '',
    outcome: r.outcome,
    status: r.source_status,
    assigneeIds: r.assignee_ids ?? [],
    targetColumnId: r.target_column_id
  })), {
    actorId: imp.uploader_id,
    structureVersion: imp.board_structure_version ?? -1
  });
}
async function readRows(client: pg.ClientBase, importId: string): Promise<DBImportRow[]> {
  return (await client.query<DBImportRow>(`SELECT *,to_char(due_date,'YYYY-MM-DD') AS due_date
    FROM card_import_rows WHERE import_id=$1 ORDER BY row_number`, [importId])).rows;
}
async function markCleaned(client: pg.ClientBase, importId: string): Promise<void> {
  await redactImportRows(client, {
    importId
  });
  await client.query(`UPDATE card_imports SET preview_digest=NULL,content_cleaned_at=NOW(),cleanup_after=NULL WHERE id=$1`, [importId]);
}
export async function createCardImport(client: pg.ClientBase, params: CreateCardImportParams): Promise<ImportStatus> {
  const {
    boardId,
    fileBuffer,
    defaultColumnId,
    actorId
  } = params;
  await assertImportAccessBeforeParse(client, boardId, actorId);
  const parsed = parseExcelWorkbook(fileBuffer);
  const access = await lockBoardAccess(client, boardId, actorId);
  await acquireWriteGrantLock(client, access.projectId, actorId, 'manager', boardId);
  const allEmails = [...new Set(parsed.rows.flatMap(r => r.assigneeEmails))];
  const eligible = await lockEligibleAssignees(client, access.projectId, boardId, allEmails);
  await acquireWritableProjectContextLock(client, access.projectId, boardId);
  const board = (await client.query<{
    workspace_id: string;
    structure_version: number;
  }>('SELECT workspace_id,structure_version FROM boards WHERE id=$1', [boardId])).rows[0]!;
  const columns = (await client.query<{
    id: string;
    name: string;
  }>('SELECT id,name FROM columns WHERE board_id=$1 AND deleted_at IS NULL ORDER BY position,id', [boardId])).rows;
  if (!columns.some(c => c.id === defaultColumnId)) throw validationError('Default column not found on this board.', {
    issues: [{
      path: 'defaultColumnId',
      message: 'Default column not found.'
    }]
  });
  const byName = new Map(columns.map(c => [c.name.trim().toLowerCase(), c.id]));
  const existing = (await client.query<{
    external_id: string;
    row_hash: string;
    card_id: string | null;
  }>('SELECT external_id,row_hash,card_id FROM card_import_duplicates WHERE board_id=$1 AND external_id=ANY($2::text[])', [boardId, parsed.rows.map(r => r.externalId)])).rows;
  const markers = new Map(existing.map(r => [r.external_id, r]));
  const importId = 'imp_' + crypto.randomUUID();
  const seen = new Set<string>();
  const rows: DBImportRow[] = parsed.rows.map(r => {
    const errors = [...r.rawErrors];
    if (seen.has(r.externalId)) errors.push({
      field: 'externalId',
      code: 'DUPLICATE_IN_BATCH',
      message: 'External ID is repeated in this workbook.'
    });
    seen.add(r.externalId);
    const assignees = r.assigneeEmails.map(e => eligible.get(e)).filter((id): id is string => Boolean(id));
    if (assignees.length !== r.assigneeEmails.length) errors.push({
      field: 'assigneeEmails',
      code: 'UNKNOWN_OR_INELIGIBLE_ASSIGNEE',
      message: 'One or more assignees cannot work on this board.'
    });
    const target = r.status ? byName.get(r.status.trim().toLowerCase()) ?? null : defaultColumnId;
    if (!target) errors.push({
      field: 'status',
      code: 'UNRECOGNIZED_STATUS',
      message: 'Status does not match a column on this board.'
    });
    const hash = computeRowHash(r);
    const marker = markers.get(r.externalId);
    let outcome: ImportRowOutcome = errors.length ? 'invalid' : 'new';
    if (marker && marker.row_hash !== hash) {
      outcome = 'conflict';
      errors.push({
        field: 'externalId',
        code: 'IMPORT_CONFLICT',
        message: 'External ID was imported with different original content.'
      });
    } else if (marker) {
      outcome = 'already_imported';
      errors.length = 0;
    }
    return {
      id: 'impr_' + crypto.randomUUID(),
      import_id: importId,
      row_number: r.rowNumber,
      external_id: r.externalId,
      title: r.title,
      description: r.description,
      status: r.status,
      source_status: r.status,
      priority: r.priority,
      due_date: r.dueDate,
      assignee_emails: r.assigneeEmails,
      assignee_ids: assignees,
      target_column_id: target,
      row_hash: hash,
      outcome,
      errors,
      card_id: marker?.card_id ?? null
    };
  });
  const state = rows.some(r => r.outcome === 'invalid' || r.outcome === 'conflict') ? 'invalid' : 'ready';
  await client.query(`INSERT INTO card_imports(id,workspace_id,project_id,board_id,default_column_id,uploader_id,
    version,state,expires_at,board_structure_version,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,1,$7,NOW()+INTERVAL '30 minutes',$8,NOW(),NOW())`, [importId, board.workspace_id, access.projectId, boardId, defaultColumnId, actorId, state, board.structure_version]);
  for (const r of rows) await client.query(`INSERT INTO card_import_rows(id,import_id,row_number,external_id,title,
    description,status,source_status,priority,due_date,assignee_emails,assignee_ids,target_column_id,row_hash,outcome,errors,card_id,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())`, [r.id, importId, r.row_number, r.external_id, r.title, r.description, r.status, r.source_status, r.priority, r.due_date, r.assignee_emails, r.assignee_ids, r.target_column_id, r.row_hash, r.outcome, JSON.stringify(r.errors), r.card_id]);
  const imp = (await client.query<DBImport>('SELECT * FROM card_imports WHERE id=$1', [importId])).rows[0]!;
  await client.query('UPDATE card_imports SET preview_digest=$2 WHERE id=$1', [importId, digestFor(imp, rows)]);
  return getCardImportStatus(client, importId, actorId, {
    limit: 200
  });
}
export async function getCardImportStatus(client: pg.ClientBase, importId: string, actorId: string, pagination?: {
  limit?: number | undefined;
  cursor?: string | undefined;
}): Promise<ImportStatus> {
  await lockImportBoard(client, importId, actorId);
  let imp = (await client.query<DBImport>('SELECT * FROM card_imports WHERE id=$1 FOR UPDATE', [importId])).rows[0]!;
  await acquireWriteGrantLock(client, imp.project_id, actorId, 'manager', imp.board_id);
  if (activePreviewStates.includes(imp.state) && imp.expires_at && new Date(imp.expires_at).getTime() <= Date.now()) {
    await client.query("UPDATE card_imports SET state='expired',updated_at=NOW() WHERE id=$1", [importId]);
    await markCleaned(client, importId);
    imp = {
      ...imp,
      state: 'expired',
      preview_digest: null
    };
  }
  const counts: ImportCounts = {
    total: 0,
    new: 0,
    existing: 0,
    invalid: 0,
    conflict: 0,
    created: 0,
    skipped: 0
  };
  for (const r of (await client.query<{
    outcome: ImportRowOutcome;
    n: number;
  }>('SELECT outcome,COUNT(*)::int AS n FROM card_import_rows WHERE import_id=$1 GROUP BY outcome', [importId])).rows) {
    counts.total += r.n;
    const key = r.outcome === 'already_imported' ? 'existing' : r.outcome;
    counts[key] += r.n;
  }
  const limit = Math.max(1, Math.min(pagination?.limit ?? 50, 200));
  const cursor = pagination?.cursor ? Number(pagination.cursor) : 0;
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw HttpError.badRequest('Invalid import row cursor.', 'VALIDATION_ERROR');
  const data = (await client.query<DBImportRow>(`SELECT *,to_char(due_date,'YYYY-MM-DD') AS due_date FROM card_import_rows
    WHERE import_id=$1 AND row_number>$2 ORDER BY row_number LIMIT $3`, [importId, cursor, limit + 1])).rows;
  const selected = data.slice(0, limit);
  const last = selected.at(-1);
  const committed=(await client.query<{actor_id:string;created_at:Date|string}>(
    `SELECT actor_id,created_at FROM activity_log WHERE project_id=$1 AND workspace_id=$2 AND board_id=$3
      AND action='card_import_committed' AND safe_changes->>'importId'=$4 ORDER BY created_at,id LIMIT 1`,
    [imp.project_id,imp.workspace_id,imp.board_id,imp.id])).rows[0];
  const createdBy=await getHistoricalPersonDisplay(client,imp.project_id,imp.uploader_id);
  const committedBy=committed
    ? committed.actor_id===imp.uploader_id ? createdBy : await getHistoricalPersonDisplay(client,imp.project_id,committed.actor_id)
    : null;
  return {
    id: imp.id,
    projectId: imp.project_id,
    boardId: imp.board_id,
    defaultColumnId: imp.default_column_id,
    version: imp.version,
    state: imp.state,
    previewDigest: imp.preview_digest,
    expiresAt: imp.expires_at ? new Date(imp.expires_at).toISOString() : null,
    serverNow: new Date().toISOString(),
    createdAt: new Date(imp.created_at).toISOString(),
    createdById: imp.uploader_id,
    createdBy,
    committedAt: committed ? new Date(committed.created_at).toISOString() : null,
    committedById: committed?.actor_id ?? null,
    committedBy,
    counts,
    canCommit: imp.state === 'ready' && !counts.invalid && !counts.conflict,
    cancellationAllowed: activePreviewStates.includes(imp.state),
    nextCursor: data.length > limit && last ? String(last.row_number) : null,
    error: null,
    rows: selected.map((r): ImportRow => {
      // Full-batch cleanup and per-card purge both remove every copied field.
      // Never turn a cleaned priority into "none" or return blank fake identities.
      if (r.row_hash === null && r.external_id === '' && r.title === '' && r.description === null) {
        return { rowNumber:r.row_number,contentRedacted:true,externalId:null,title:null,
          description:null,status:null,priority:null,dueDate:null,assigneeIds:[],
          outcome:r.outcome,errors:[],cardId:r.card_id };
      }
      const content = {
      rowNumber: r.row_number,
      contentRedacted: false as const,
      externalId: r.external_id,
      title: r.title,
      description: r.description ?? '',
      status: r.status,
      priority: r.priority as Priority ?? 'none',
      dueDate: r.due_date as string | null,
      assigneeIds: r.assignee_ids ?? [],
      errors: r.errors ?? [],
      cardId: r.card_id
      };
      if (r.outcome === 'invalid' || r.outcome === 'conflict') return {...content,outcome:r.outcome};
      return {...content,outcome:r.outcome};
    })
  };
}
export async function updateImportMappings(client: pg.ClientBase, importId: string, actorId: string, input: UpdateImportMappingsInput): Promise<ImportStatus> {
  await lockImportBoard(client, importId, actorId);
  let imp = (await client.query<DBImport>('SELECT * FROM card_imports WHERE id=$1', [importId])).rows[0]!;
  await acquireWriteGrantLock(client, imp.project_id, actorId, 'manager', imp.board_id);
  if (!activePreviewStates.includes(imp.state)) throw HttpError.conflict('INVALID_STATE', 'Cannot change this import.');
  if (imp.expires_at && new Date(imp.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'PREVIEW_EXPIRED', 'Preview expired.');
  if (imp.version !== input.expectedVersion) throw HttpError.conflict('STALE_VERSION', 'Stale import version.');
  let rows = await readRows(client, importId);
  const eligible = await lockEligibleAssignees(client, imp.project_id, imp.board_id, [...new Set(rows.flatMap(r => r.assignee_emails ?? []))]);
  await acquireWritableProjectContextLock(client, imp.project_id, imp.board_id);
  imp = (await client.query<DBImport>('SELECT * FROM card_imports WHERE id=$1 FOR UPDATE', [importId])).rows[0]!;
  if (!activePreviewStates.includes(imp.state) || imp.version !== input.expectedVersion) throw HttpError.conflict('STALE_VERSION', 'Import changed while mapping.');
  if (imp.expires_at && new Date(imp.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'PREVIEW_EXPIRED', 'Preview expired.');
  rows = await readRows(client, importId);
  const board = (await client.query<{
    structure_version: number;
  }>('SELECT structure_version FROM boards WHERE id=$1', [imp.board_id])).rows[0]!;
  const cols = (await client.query<{
    id: string;
    name: string;
  }>('SELECT id,name FROM columns WHERE board_id=$1 AND deleted_at IS NULL', [imp.board_id])).rows;
  const byId = new Map(cols.map(c => [c.id, c.name]));
  const mappings=new Map([...Object.entries(input.mappings),...(input.mappingEntries??[]).map(entry=>[entry.sourceStatus,entry.columnId] as const)]);
  if ([...mappings.values()].some(id => !byId.has(id))) throw validationError('Mapped column is not on this board.');
  for (const r of rows) {
    let errors = (r.errors ?? []).filter(e => e.code !== 'UNKNOWN_OR_INELIGIBLE_ASSIGNEE');
    const assignees = (r.assignee_emails ?? []).map(e => eligible.get(e)).filter((id): id is string => Boolean(id));
    if (assignees.length !== (r.assignee_emails ?? []).length) errors.push({
      field: 'assigneeEmails',
      code: 'UNKNOWN_OR_INELIGIBLE_ASSIGNEE',
      message: 'One or more assignees cannot work on this board.'
    });
    const mapped = r.source_status ? mappings.get(r.source_status) : undefined;
    if (mapped) {
      r.target_column_id = mapped;
      r.status = byId.get(mapped)!;
      errors = errors.filter(e => e.code !== 'UNRECOGNIZED_STATUS');
    }
    if (r.target_column_id && !byId.has(r.target_column_id)) {
      r.target_column_id = null;
      errors.push({
        field: 'status',
        code: 'UNRECOGNIZED_STATUS',
        message: 'Destination column changed.'
      });
    }
    if (r.target_column_id && byId.has(r.target_column_id)) r.status = byId.get(r.target_column_id)!;
    r.assignee_ids = assignees;
    r.errors = errors;
    if (r.outcome !== 'conflict' && r.outcome !== 'already_imported') r.outcome = errors.length ? 'invalid' : 'new';
    await client.query('UPDATE card_import_rows SET status=$2,target_column_id=$3,assignee_ids=$4,errors=$5,outcome=$6 WHERE id=$1', [r.id, r.status, r.target_column_id, assignees, JSON.stringify(errors), r.outcome]);
  }
  imp.version++;
  imp.board_structure_version = board.structure_version;
  const state = rows.some(r => r.outcome === 'invalid' || r.outcome === 'conflict') ? 'invalid' : 'ready';
  await client.query('UPDATE card_imports SET version=$2,state=$3,board_structure_version=$4,preview_digest=$5,updated_at=NOW() WHERE id=$1', [importId, imp.version, state, imp.board_structure_version, digestFor(imp, rows)]);
  return getCardImportStatus(client, importId, actorId);
}

/** Called by the HTTP handler BEFORE its writable-board/receipt lock. */
export async function prepareImportCommitAccess(client: pg.ClientBase, importId: string, actorId: string): Promise<void> {
  await lockImportBoard(client, importId, actorId);
  const imp = (await client.query<DBImport>('SELECT * FROM card_imports WHERE id=$1', [importId])).rows[0]!;
  await acquireWriteGrantLock(client, imp.project_id, actorId, 'manager', imp.board_id);
  const rows = await readRows(client, importId);
  await lockEligibleAssignees(client, imp.project_id, imp.board_id, [...new Set(rows.flatMap(r => r.assignee_emails ?? []))]);
}
export async function commitCardImport(client: pg.ClientBase, importId: string, actorId: string, input: CommitImportInput): Promise<ImportStatus> {
  await prepareImportCommitAccess(client, importId, actorId);
  const scope = (await client.query<DBImport>('SELECT * FROM card_imports WHERE id=$1', [importId])).rows[0]!;
  await acquireWritableProjectContextLock(client, scope.project_id, scope.board_id);
  const imp = (await client.query<DBImport>('SELECT * FROM card_imports WHERE id=$1 FOR UPDATE', [importId])).rows[0]!;
  if (imp.state === 'committed') return getCardImportStatus(client, importId, actorId);
  if (imp.expires_at && new Date(imp.expires_at).getTime() <= Date.now()) throw new HttpError(410, 'PREVIEW_EXPIRED', 'This preview expired. Upload again.');
  if (imp.state !== 'ready') throw HttpError.conflict('INVALID_STATE', 'Import is not ready.');
  const rows = await readRows(client, importId);
  if (imp.version !== input.expectedVersion) throw HttpError.conflict('STALE_VERSION', 'Stale import version.');
  if (input.defaultColumnId !== imp.default_column_id || imp.preview_digest !== input.previewDigest || digestFor(imp, rows) !== imp.preview_digest) throw HttpError.conflict('PREVIEW_STALE', 'Preview configuration changed. Preview again.');
  const board = (await client.query<{
    structure_version: number;
  }>('SELECT structure_version FROM boards WHERE id=$1', [imp.board_id])).rows[0]!;
  const eligible = await lockEligibleAssignees(client, imp.project_id, imp.board_id, [...new Set(rows.flatMap(r => r.assignee_emails ?? []))]);
  // The board lock serializes ALL confirmations, including separately created previews.
  // Inspect durable identities before any domain write so changed-content conflicts roll back the whole batch.
  const markers = (await client.query<{
    external_id: string;
    row_hash: string;
    card_id: string | null;
  }>('SELECT external_id,row_hash,card_id FROM card_import_duplicates WHERE board_id=$1 AND external_id=ANY($2::text[])', [imp.board_id, rows.map(r => r.external_id)])).rows;
  const existing = new Map(markers.map(r => [r.external_id, r]));
  for (const r of rows) {
    const marker = existing.get(r.external_id);
    if (marker && marker.row_hash !== r.row_hash) throw HttpError.conflict('IMPORT_CONFLICT', 'External ID was imported with different original content.');
  }
  if ((rows.length === 0 || rows.some(r => !existing.has(r.external_id))) && imp.board_structure_version !== board.structure_version) throw HttpError.conflict('PREVIEW_STALE', 'Board columns or order changed. Preview again.');
  for (const r of rows) {
    if (!r.row_hash || r.description === null) throw HttpError.conflict('PREVIEW_STALE', 'Legacy preview lacks original data. Upload again.');
    if (existing.has(r.external_id)) continue;
    const current = (r.assignee_emails ?? []).map(e => eligible.get(e));
    if (current.some(id => !id) || JSON.stringify([...current].sort()) !== JSON.stringify([...(r.assignee_ids ?? [])].sort())) throw HttpError.conflict('PREVIEW_STALE', 'Assignee access changed. Preview again.');
    const col = await client.query('SELECT id FROM columns WHERE id=$1 AND board_id=$2 AND deleted_at IS NULL', [r.target_column_id, imp.board_id]);
    if (!col.rows[0]) throw HttpError.conflict('PREVIEW_STALE', 'Destination changed. Preview again.');
    if (r.outcome === 'invalid' || r.outcome === 'conflict') throw HttpError.unprocessable('IMPORT_HAS_ERRORS', 'Import has invalid or conflicting rows.');
  }
  // Reserve every NEW source identity before any card effect. Database uniqueness is
  // the final backstop; failure rolls back reservations with cards/history/receipt.
  for (const r of rows) {
    if (!existing.has(r.external_id)) {
      await client.query('INSERT INTO card_import_duplicates(workspace_id,project_id,board_id,external_id,card_id,row_hash,created_at) VALUES($1,$2,$3,$4,NULL,$5,NOW())', [imp.workspace_id, imp.project_id, imp.board_id, r.external_id, r.row_hash]);
    }
  }
  let created = 0;
  for (const r of rows) {
    const marker = existing.get(r.external_id);
    if (marker) {
      await client.query("UPDATE card_import_rows SET outcome='skipped',card_id=$2 WHERE id=$1", [r.id, marker.card_id]);
      continue;
    }
    const id = 'crd_' + crypto.randomUUID();
    await client.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,description,priority,due_date,position,version,state,created_at,updated_at)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE(MAX(position),0)+1000,1,'active',NOW(),NOW()
      FROM cards WHERE column_id=$5 AND state='active'`, [id, imp.workspace_id, imp.project_id, imp.board_id, r.target_column_id, r.title, r.description, r.priority ?? 'none', r.due_date]);
    for (const userId of r.assignee_ids ?? []) await client.query('INSERT INTO card_assignees(card_id,user_id,workspace_id,project_id,created_at) VALUES($1,$2,$3,$4,NOW())', [id, userId, imp.workspace_id, imp.project_id]);
    await client.query('UPDATE card_import_duplicates SET card_id=$3 WHERE board_id=$1 AND external_id=$2', [imp.board_id, r.external_id, id]);
    await client.query("UPDATE card_import_rows SET outcome='created',card_id=$2 WHERE id=$1", [r.id, id]);
    await recordActivity(client, {
      workspaceId: imp.workspace_id,
      projectId: imp.project_id,
      boardId: imp.board_id,
      cardId: id,
      actorId,
      action: 'card_created',
      safeChanges: {
        source: 'excel_import',
        importId,
        externalId: r.external_id,
        rowNumber: r.row_number,
        title: r.title
      }
    });
    created++;
  }
  await client.query('UPDATE boards SET snapshot_version=snapshot_version+1,structure_version=structure_version+1,updated_at=NOW() WHERE id=$1', [imp.board_id]);
  await recordActivity(client, {
    workspaceId: imp.workspace_id,
    projectId: imp.project_id,
    boardId: imp.board_id,
    actorId,
    action: 'card_import_committed',
    safeChanges: {
      importId,
      createdCount: created,
      skippedCount: rows.length - created
    }
  });
  await client.query("UPDATE card_imports SET state='committed',version=version+1,cleanup_after=NOW()+INTERVAL '30 minutes',updated_at=NOW() WHERE id=$1", [importId]);
  return getCardImportStatus(client, importId, actorId);
}
export async function cancelCardImport(client: pg.ClientBase, importId: string, actorId: string): Promise<{
  id: string;
  state: 'cancelled';
}> {
  await lockImportBoard(client, importId, actorId);
  const imp = (await client.query<DBImport>('SELECT * FROM card_imports WHERE id=$1 FOR UPDATE', [importId])).rows[0]!;
  await acquireWriteGrantLock(client, imp.project_id, actorId, 'manager', imp.board_id);
  if (['committing', 'committed'].includes(imp.state)) throw HttpError.conflict('COMMIT_IN_PROGRESS', 'Import already committed or committing.');
  await client.query("UPDATE card_imports SET state='cancelled',updated_at=NOW() WHERE id=$1", [importId]);
  await markCleaned(client, importId);
  return {
    id: importId,
    state: 'cancelled'
  };
}
export async function getImportReport(client: pg.ClientBase, importId: string, actorId: string): Promise<string> {
  await lockImportBoard(client, importId, actorId);
  const imp = (await client.query<DBImport>('SELECT * FROM card_imports WHERE id=$1', [importId])).rows[0]!;
  await acquireWriteGrantLock(client, imp.project_id, actorId, 'manager', imp.board_id);
  const rows = await readRows(client, importId);
  const cell = (v: unknown) => {
    let s = String(v ?? '');
    if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return ['Row,External ID,Title,Status,Priority,Due Date,Outcome,Errors,Card ID', ...rows.map(r => [r.row_number, r.external_id, r.title, r.status, r.priority ?? 'none', r.due_date, r.outcome, (r.errors ?? []).map(e => e.message).join('; '), r.card_id].map(cell).join(','))].join('\r\n');
}
