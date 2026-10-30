import type pg from 'pg';
import type { ActivityItem, PersonDisplay } from '@flowboard/contracts';
import { getPool } from './postgres.ts';
import { getHistoricalPersonDisplay } from './rbac.ts';
import { HttpError } from '../http/errors.ts';
import { createHash } from 'node:crypto';
import { lockBoardAccess } from './board-grants-foundation.ts';

export interface ActivityCursor {
  v: 2;
  scope: 'card' | 'project' | 'workspace';
  scopeId: string;
  actorId: string;
  scopeDigest: string;
  createdAt: string;
  id: string;
}

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return btoa(JSON.stringify(cursor))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function decodeActivityCursor(
  value: string,
  expectedScope: 'card' | 'project' | 'workspace',
  expectedScopeId: string,
  actorId: string,
  scopeDigest: string,
): ActivityCursor {
  try {
    const base64 =
      value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const parsed = JSON.parse(atob(base64)) as Partial<ActivityCursor>;
    if (
      parsed.v !== 2 ||
      parsed.scope !== expectedScope ||
      parsed.scopeId !== expectedScopeId ||
      parsed.actorId !== actorId ||
      parsed.scopeDigest !== scopeDigest ||
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0
    ) {
      throw new Error('invalid activity cursor');
    }
    return parsed as ActivityCursor;
  } catch {
    throw HttpError.conflict('STALE_CURSOR', 'Activity cursor is invalid or belongs to another scope.');
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function inActivityTransaction<T>(db: pg.Pool | pg.ClientBase, run: (client: pg.ClientBase) => Promise<T>): Promise<T> {
  if (typeof (db as pg.Pool).totalCount !== 'number') return run(db as pg.ClientBase);
  const client = await (db as pg.Pool).connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    (client as pg.PoolClient).release();
  }
}

async function lockProjectActivityAccess(client: pg.ClientBase, projectId: string, actorId: string) {
  const context = await client.query<{ workspace_id: string; owner_id: string }>(
    `SELECT p.workspace_id, w.owner_id FROM projects p JOIN workspaces w ON w.id=p.workspace_id
     WHERE p.id=$1 FOR SHARE OF w`, [projectId]);
  const row = context.rows[0];
  if (!row) throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  if (row.owner_id === actorId) return { owner: true, digest: digest({ projectId, actorId, owner: true }) };
  const membership = await client.query<{ role: string; status: string }>(
    `SELECT role,status FROM project_memberships WHERE project_id=$1 AND user_id=$2 FOR SHARE`, [projectId, actorId]);
  if (membership.rows[0]?.status !== 'active') throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  if (membership.rows[0]?.role !== 'manager') throw HttpError.forbidden('Only project managers and workspace owners can view project-wide activity.', 'FORBIDDEN');
  const grants = await client.query<{ id: string; access_revision: string }>(
    `SELECT b.id,b.access_revision FROM boards b JOIN board_grants g
       ON g.board_id=b.id AND g.project_id=b.project_id AND g.workspace_id=b.workspace_id
     WHERE b.project_id=$1 AND g.user_id=$2 ORDER BY b.id FOR SHARE OF g`, [projectId, actorId]);
  return { owner: false, digest: digest({ projectId, actorId, role: 'manager', grants: grants.rows }) };
}

export interface ListCardActivityOptions {
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface ListActivityResponse {
  data: ActivityItem[];
  nextCursor: string | null;
}

/**
 * AUD-01, AUD-02: Chronological event timeline for card (creation, field changes, assignments, movements, comments, attachments)
 * with cursor pagination.
 * Verifies project reader authorization (returns 404 for outsiders and sibling project members).
 */
export async function listCardActivity(
  poolOrClient: pg.Pool | pg.ClientBase,
  cardId: string,
  actorId: string,
  options?: ListCardActivityOptions,
): Promise<ListActivityResponse> {
  return inActivityTransaction(poolOrClient ?? getPool(), async (pool) => {

  // 1. Fetch card details to identify project and state
  const cardRes = await pool.query<{
    id: string;
    project_id: string;
    workspace_id: string;
    board_id: string;
    state: string;
    title: string;
    card_key: string;
  }>(
    `SELECT c.id, c.project_id, c.workspace_id, c.board_id, c.state, c.title,
       p.key_prefix || '-' || c.card_number::text AS card_key
     FROM cards c
     JOIN projects p ON p.id = c.project_id
     WHERE c.id = $1`,
    [cardId],
  );

  if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  const card = cardRes.rows[0];

  // Trashed or purged cards are hidden from normal card readers (DEL-08, COM-06)
  if (card.state === 'trashed' || card.state === 'purged') {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  // 2. Verify actor has project access (outsiders get 404)
  let isOwner = false;
  try {
    const access = await lockBoardAccess(pool, card.board_id, actorId);
    isOwner = access.role === 'owner';
    if (access.projectId !== card.project_id || access.workspaceId !== card.workspace_id) throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    throw error;
  }

  const currentCard = await pool.query<{ state: string }>(
    `SELECT state FROM cards WHERE id=$1 AND project_id=$2 AND workspace_id=$3 AND board_id=$4 FOR SHARE`,
    [cardId, card.project_id, card.workspace_id, card.board_id]);
  if (currentCard.rows[0]?.state !== 'active') throw HttpError.notFound('Card not found.', 'NOT_FOUND');

  const revision = await pool.query<{ access_revision: string }>('SELECT access_revision FROM boards WHERE id=$1', [card.board_id]);
  const scopeDigest = digest({ cardId, actorId, boardId: card.board_id, revision: revision.rows[0]?.access_revision });

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const cursor = options?.cursor ? decodeActivityCursor(options.cursor, 'card', cardId, actorId, scopeDigest) : undefined;

  // 3. Query activity_log ordered chronologically (created_at ASC, id ASC)
  const activityRes = await pool.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    card_id: string | null;
    actor_id: string;
    action: string;
    safe_changes: Record<string, unknown> | null;
    created_at: Date;
    cursor_time: string;
  }>(
    `SELECT id, workspace_id, project_id, card_id, actor_id, action, safe_changes, created_at,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
     FROM activity_log
     WHERE card_id = $1 AND project_id=$5 AND workspace_id=$6
       AND ((visibility_scope='board' AND board_id=$7) OR ($8::boolean AND visibility_scope='unknown'))
       AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3::text))
     ORDER BY created_at ASC, id ASC
     LIMIT $4`,
    [cardId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1, card.project_id, card.workspace_id, card.board_id, isOwner],
  );

  const rawRows = activityRes.rows;
  const hasMore = rawRows.length > limit;
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? encodeActivityCursor({
          v: 2,
          scope: 'card',
          scopeId: cardId,
          actorId,
          scopeDigest,
          createdAt: lastRow.cursor_time,
          id: lastRow.id,
        })
      : null;

  // 4. Batch-load actor PersonDisplay identities
  const actorIds = Array.from(new Set(pageRows.map((r) => r.actor_id)));
  const actorsMap = new Map<string, PersonDisplay>();

  await Promise.all(
    actorIds.map(async (actId) => {
      const display = await getHistoricalPersonDisplay(pool, card.project_id, actId);
      if (display) {
        actorsMap.set(actId, display);
      } else {
        const userRes = await pool.query<{ id: string; display_name: string; avatar_url: string | null }>(
          'SELECT id, display_name, avatar_url FROM users WHERE id = $1',
          [actId],
        );
        if (userRes.rows.length > 0) {
          const u = userRes.rows[0]!;
          actorsMap.set(actId, {
            id: u.id,
            displayName: u.display_name,
            avatarUrl: u.avatar_url,
            activeInProject: false,
            scopedRole: 'viewer',
            assignable: false,
            mentionable: false,
          });
        }
      }
    }),
  );

  const data: ActivityItem[] = pageRows.map((row) => ({
    id: row.id,
    cardId: row.card_id,
    projectId: row.project_id,
    actorId: row.actor_id,
    action: row.action,
    safeChanges: (row.safe_changes as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at).toISOString(),
    actor: actorsMap.get(row.actor_id),
    // Card title and key are shown only because this feed is already scoped to one card the actor passed.
    boardId: card.board_id,
    cardKey: card.card_key,
    cardTitle: card.title,
  }));

  return { data, nextCursor };
  });
}

export interface ListProjectActivityOptions {
  limit?: number | undefined;
  cursor?: string | undefined;
  cardId?: string | undefined;
  actorId?: string | undefined;
  action?: string | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
}

/**
 * AUD-04: Manager sees project activity/access changes; member/viewer sees card activity only in granted project.
 */
export async function listProjectActivity(
  poolOrClient: pg.Pool | pg.ClientBase,
  projectId: string,
  actorId: string,
  options?: ListProjectActivityOptions,
): Promise<ListActivityResponse> {
  return inActivityTransaction(poolOrClient ?? getPool(), async (pool) => {

  // 1. Verify project exists
  const prjRes = await pool.query<{ id: string; workspace_id: string }>(
    'SELECT id, workspace_id FROM projects WHERE id = $1',
    [projectId],
  );
  if (prjRes.rows.length === 0) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }

  // 2. Role check
  const access = await lockProjectActivityAccess(pool, projectId, actorId);
  const scopeDigest = digest({ access: access.digest, filters: {
    cardId: options?.cardId ?? null, actorId: options?.actorId ?? null,
    action: options?.action ?? null, fromDate: options?.fromDate ?? null, toDate: options?.toDate ?? null,
  } });

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const cursor = options?.cursor ? decodeActivityCursor(options.cursor, 'project', projectId, actorId, scopeDigest) : undefined;

  // 3. Build dynamic query with filters
  const params: unknown[] = [projectId];
  let paramIdx = 2;

  // Project-scope rows (member, invitation, brief and links events) reach here only for the owner or
  // a manager: lockProjectActivityAccess already refused members and viewers. Unknown legacy rows
  // stay owner-only. Board rows need a grant unless the caller is the owner.
  let whereClause = `WHERE a.project_id = $1 AND ($2::boolean OR a.visibility_scope='project' OR
    (a.visibility_scope='board' AND EXISTS (
      SELECT 1 FROM board_grants g JOIN boards b ON b.id=g.board_id
        AND b.project_id=g.project_id AND b.workspace_id=g.workspace_id
      WHERE g.board_id=a.board_id AND g.project_id=a.project_id AND g.workspace_id=a.workspace_id AND g.user_id=$3)))`;
  params.push(access.owner, actorId);
  paramIdx = 4;

  if (options?.cardId) {
    whereClause += ` AND a.card_id = $${paramIdx++}`;
    params.push(options.cardId);
  }

  if (options?.actorId) {
    whereClause += ` AND a.actor_id = $${paramIdx++}`;
    params.push(options.actorId);
  }

  if (options?.action) {
    whereClause += ` AND a.action = $${paramIdx++}`;
    params.push(options.action);
  }

  if (options?.fromDate) {
    whereClause += ` AND a.created_at >= $${paramIdx++}::timestamptz`;
    params.push(options.fromDate);
  }

  if (options?.toDate) {
    whereClause += ` AND a.created_at <= $${paramIdx++}::timestamptz`;
    params.push(options.toDate);
  }

  if (cursor) {
    whereClause += ` AND (a.created_at, a.id) < ($${paramIdx++}::timestamptz, $${paramIdx++}::text)`;
    params.push(cursor.createdAt, cursor.id);
  }

  params.push(limit + 1);
  const limitParamIdx = paramIdx;

  const activityRes = await pool.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    card_id: string | null;
    actor_id: string;
    action: string;
    safe_changes: Record<string, unknown> | null;
    created_at: Date;
    cursor_time: string;
  }>(
    `SELECT a.id, a.workspace_id, a.project_id, a.card_id, a.actor_id, a.action, a.safe_changes, a.created_at,
       to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
     FROM activity_log a
     ${whereClause}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $${limitParamIdx}`,
    params,
  );

  const rawRows = activityRes.rows;
  const hasMore = rawRows.length > limit;
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? encodeActivityCursor({
          v: 2,
          scope: 'project',
          scopeId: projectId,
          actorId,
          scopeDigest,
          createdAt: lastRow.cursor_time,
          id: lastRow.id,
        })
      : null;

  // Batch-load actor PersonDisplay identities
  const actorIds = Array.from(new Set(pageRows.map((r) => r.actor_id)));
  const actorsMap = new Map<string, PersonDisplay>();

  await Promise.all(
    actorIds.map(async (actId) => {
      const display = await getHistoricalPersonDisplay(pool, projectId, actId);
      if (display) {
        actorsMap.set(actId, display);
      } else {
        const userRes = await pool.query<{ id: string; display_name: string; avatar_url: string | null }>(
          'SELECT id, display_name, avatar_url FROM users WHERE id = $1',
          [actId],
        );
        if (userRes.rows.length > 0) {
          const u = userRes.rows[0]!;
          actorsMap.set(actId, {
            id: u.id,
            displayName: u.display_name,
            avatarUrl: u.avatar_url,
            activeInProject: false,
            scopedRole: 'viewer',
            assignable: false,
            mentionable: false,
          });
        }
      }
    }),
  );

  const data: ActivityItem[] = pageRows.map((row) => ({
    id: row.id,
    cardId: row.card_id,
    projectId: row.project_id,
    actorId: row.actor_id,
    action: row.action,
    safeChanges: (row.safe_changes as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at).toISOString(),
    actor: actorsMap.get(row.actor_id),
  }));

  return { data, nextCursor };
  });
}

export interface ListWorkspaceActivityOptions {
  limit?: number | undefined;
  cursor?: string | undefined;
  projectId?: string | undefined;
  cardId?: string | undefined;
  actorId?: string | undefined;
  action?: string | undefined;
  fromDate?: string | undefined;
  toDate?: string | undefined;
}

/**
 * AUD-03: Owner cross-project activity. Owner filters owned workspace activity by project/card/actor/action/date.
 * Outsiders and invited members are blocked with 403/404.
 */
export async function listWorkspaceActivity(
  poolOrClient: pg.Pool | pg.ClientBase,
  workspaceId: string,
  actorId: string,
  options?: ListWorkspaceActivityOptions,
): Promise<ListActivityResponse> {
  return inActivityTransaction(poolOrClient ?? getPool(), async (pool) => {

  // 1. Check workspace existence and ownership
  const wsRes = await pool.query<{ id: string; owner_id: string }>(
    'SELECT id, owner_id FROM workspaces WHERE id = $1 FOR SHARE',
    [workspaceId],
  );
  if (wsRes.rows.length === 0) {
    throw HttpError.notFound('Workspace not found.', 'NOT_FOUND');
  }

  const ws = wsRes.rows[0]!;
  if (ws.owner_id !== actorId) {
    // Check if user is a member of any project in this workspace
    const memberRes = await pool.query(
      `SELECT 1 FROM project_memberships pm
       JOIN projects p ON p.id = pm.project_id
       WHERE p.workspace_id = $1 AND pm.user_id = $2 AND pm.status = 'active'
       LIMIT 1`,
      [workspaceId, actorId],
    );
    if (memberRes.rows.length > 0) {
      throw HttpError.forbidden('Only workspace owners can view workspace activity.', 'FORBIDDEN');
    }
    throw HttpError.notFound('Workspace not found.', 'NOT_FOUND');
  }

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const scopeDigest = digest({ workspaceId, actorId, filters: {
    projectId: options?.projectId ?? null, cardId: options?.cardId ?? null,
    actorId: options?.actorId ?? null, action: options?.action ?? null,
    fromDate: options?.fromDate ?? null, toDate: options?.toDate ?? null,
  } });
  const cursor = options?.cursor ? decodeActivityCursor(options.cursor, 'workspace', workspaceId, actorId, scopeDigest) : undefined;

  // 2. Build dynamic query with filters
  const params: unknown[] = [workspaceId];
  let paramIdx = 2;

  let whereClause = 'WHERE workspace_id = $1';

  if (options?.projectId) {
    whereClause += ` AND project_id = $${paramIdx++}`;
    params.push(options.projectId);
  }

  if (options?.cardId) {
    whereClause += ` AND card_id = $${paramIdx++}`;
    params.push(options.cardId);
  }

  if (options?.actorId) {
    whereClause += ` AND actor_id = $${paramIdx++}`;
    params.push(options.actorId);
  }

  if (options?.action) {
    whereClause += ` AND action = $${paramIdx++}`;
    params.push(options.action);
  }

  if (options?.fromDate) {
    whereClause += ` AND created_at >= $${paramIdx++}::timestamptz`;
    params.push(options.fromDate);
  }

  if (options?.toDate) {
    whereClause += ` AND created_at <= $${paramIdx++}::timestamptz`;
    params.push(options.toDate);
  }

  if (cursor) {
    whereClause += ` AND (created_at, id) < ($${paramIdx++}::timestamptz, $${paramIdx++}::text)`;
    params.push(cursor.createdAt, cursor.id);
  }

  params.push(limit + 1);
  const limitParamIdx = paramIdx;

  const activityRes = await pool.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    card_id: string | null;
    actor_id: string;
    action: string;
    safe_changes: Record<string, unknown> | null;
    created_at: Date;
    cursor_time: string;
  }>(
    `SELECT id, workspace_id, project_id, card_id, actor_id, action, safe_changes, created_at,
       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
     FROM activity_log
     ${whereClause}
     ORDER BY created_at DESC, id DESC
     LIMIT $${limitParamIdx}`,
    params,
  );

  const rawRows = activityRes.rows;
  const hasMore = rawRows.length > limit;
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? encodeActivityCursor({
          v: 2,
          scope: 'workspace',
          scopeId: workspaceId,
          actorId,
          scopeDigest,
          createdAt: lastRow.cursor_time,
          id: lastRow.id,
        })
      : null;

  // Batch-load actor PersonDisplay identities
  const actorIds = Array.from(new Set(pageRows.map((r) => r.actor_id)));
  const actorsMap = new Map<string, PersonDisplay>();

  await Promise.all(
    actorIds.map(async (actId) => {
      const userRes = await pool.query<{ id: string; display_name: string; avatar_url: string | null }>(
        'SELECT id, display_name, avatar_url FROM users WHERE id = $1',
        [actId],
      );
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0]!;
        const isOwner = ws.owner_id === actId;
        actorsMap.set(actId, {
          id: u.id,
          displayName: u.display_name,
          avatarUrl: u.avatar_url,
          activeInProject: true,
          scopedRole: isOwner ? 'owner' : 'member',
          assignable: true,
          mentionable: true,
        });
      }
    }),
  );

  const data: ActivityItem[] = pageRows.map((row) => ({
    id: row.id,
    cardId: row.card_id,
    projectId: row.project_id,
    actorId: row.actor_id,
    action: row.action,
    safeChanges: (row.safe_changes as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at).toISOString(),
    actor: actorsMap.get(row.actor_id),
  }));

  return { data, nextCursor };
  });
}

/**
 * AUD-06: Append-only history and redaction. Redacts safe_changes for deleted/purged card content
 * while strictly preserving the immutable activity row, actor, action, and timestamp facts.
 */
export async function redactCardActivity(
  client: pg.ClientBase,
  cardId: string,
): Promise<void> {
  await client.query(
    `UPDATE activity_log
     SET safe_changes = jsonb_build_object('cardId', $1::text, 'purged', true)
     WHERE card_id = $1`,
    [cardId],
  );
}

export interface RecordActivityOptions {
  id?: string | undefined;
  workspaceId: string;
  projectId: string;
  boardId?: string | null | undefined;
  cardId?: string | null | undefined;
  actorId: string;
  action: string;
  safeChanges?: Record<string, unknown> | null | undefined;
  visibilityScope?: 'board' | 'project' | 'unknown' | undefined;
  createdAt?: string | Date | undefined;
}

/**
 * Canonical activity_log writer. Automatically populates board_id and visibility_scope
 * when the database schema supports them, strictly complying with the activity_scope_shape
 * constraint and validate_activity_scope_draft_trigger.
 */
export async function recordActivity(
  client: pg.ClientBase | pg.Pool,
  options: RecordActivityOptions,
): Promise<string> {
  const actId = options.id ?? 'act_' + crypto.randomUUID();
  const safeChangesJson = options.safeChanges ? JSON.stringify(options.safeChanges) : '{}';

  // Check if visibility_scope column exists on activity_log
  const scopeRes = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_attribute 
       WHERE attrelid = to_regclass('activity_log') 
         AND attname = 'visibility_scope' 
         AND NOT attisdropped
     ) AS exists`,
  );
  const hasScope = Boolean(scopeRes.rows[0]?.exists);

  if (hasScope) {
    let scope = options.visibilityScope;
    let boardId = options.boardId ?? null;

    if (options.cardId) {
      scope = 'board';
      if (!boardId) {
        const cRes = await client.query<{ board_id: string }>(
          'SELECT board_id FROM cards WHERE id = $1',
          [options.cardId],
        );
        boardId = cRes.rows[0]?.board_id ?? null;
      }
    } else if (boardId) {
      scope = scope ?? 'board';
    } else {
      scope = scope ?? 'project';
    }

    if (scope === 'board' && !boardId) {
      scope = 'unknown';
    } else if (scope !== 'board') {
      boardId = null;
    }

    if (options.createdAt) {
      await client.query(
        `INSERT INTO activity_log (
           id, workspace_id, project_id, board_id, visibility_scope, card_id, actor_id, action, safe_changes, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        [
          actId,
          options.workspaceId,
          options.projectId,
          boardId,
          scope,
          options.cardId ?? null,
          options.actorId,
          options.action,
          safeChangesJson,
          options.createdAt instanceof Date ? options.createdAt.toISOString() : options.createdAt,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO activity_log (
           id, workspace_id, project_id, board_id, visibility_scope, card_id, actor_id, action, safe_changes, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())`,
        [
          actId,
          options.workspaceId,
          options.projectId,
          boardId,
          scope,
          options.cardId ?? null,
          options.actorId,
          options.action,
          safeChangesJson,
        ],
      );
    }
  } else {
    // Legacy schema fallback
    if (options.createdAt) {
      await client.query(
        `INSERT INTO activity_log (
           id, workspace_id, project_id, card_id, actor_id, action, safe_changes, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          actId,
          options.workspaceId,
          options.projectId,
          options.cardId ?? null,
          options.actorId,
          options.action,
          safeChangesJson,
          options.createdAt instanceof Date ? options.createdAt.toISOString() : options.createdAt,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO activity_log (
           id, workspace_id, project_id, card_id, actor_id, action, safe_changes, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
        [
          actId,
          options.workspaceId,
          options.projectId,
          options.cardId ?? null,
          options.actorId,
          options.action,
          safeChangesJson,
        ],
      );
    }
  }

  return actId;
}
