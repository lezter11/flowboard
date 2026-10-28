/** UNMOUNTED prototype; never use as production authorization or an API contract.
 * Callers must supply an authenticated actor and execute this read-only helper
 * inside a REPEATABLE READ transaction; see remaining cutover gaps below.
 */
import type pg from 'pg';
import { createHash } from 'node:crypto';
import { HttpError } from '../http/errors.ts';

export interface ActivityDraftCursor {
  projectId: string;
  actorId: string;
  scopeDigest: string;
  createdAt: string;
  id: string;
}
export interface ScopedActivityDraftRow {
  id: string;
  board_id: string | null;
  visibility_scope: string;
  action: string;
  safe_changes: unknown;
  created_at: Date;
  cursor_time: string;
}

/** Internal cursor is structured data, not authenticated: production must
 * authenticate/bind cursor, validate filters, and handle owner transfer races.
 * Project and unknown events are Owner-only until project-event payloads have
 * an explicit action-specific safe allowlist. A scope label alone is not proof
 * that safe_changes cannot contain a hidden board ID.
 * This query is not mounted, does not implement card feed or grant audit, and
 * has not been independently reviewed. No API or live data should use it.
 */
export async function listScopedProjectActivityDraft(
  client: pg.PoolClient, projectId: string, actorId: string,
  options: { limit?: number; cursor?: ActivityDraftCursor } = {},
): Promise<{ items: ScopedActivityDraftRow[]; nextCursor: ActivityDraftCursor | null }> {
  const p = await client.query<{ owner_id: string; role: string | null }>(
    `SELECT w.owner_id, m.role FROM projects p JOIN workspaces w ON w.id=p.workspace_id
     LEFT JOIN project_memberships m ON m.project_id=p.id AND m.user_id=$2 AND m.status='active'
     WHERE p.id=$1`, [projectId, actorId]);
  const context = p.rows[0];
  if (!context || (context.owner_id !== actorId && !context.role)) throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  const owner = context.owner_id === actorId;
  if (!owner && context.role !== 'manager') throw HttpError.forbidden('Project activity is limited to administrators.', 'FORBIDDEN');
  const grants = await client.query<{ id: string; access_revision: string }>(
    `SELECT b.id, b.access_revision FROM boards b
     WHERE b.project_id=$1 AND ($3::boolean OR EXISTS (
       SELECT 1 FROM board_grants g JOIN project_memberships m ON m.project_id=g.project_id AND m.user_id=g.user_id AND m.status='active'
       WHERE g.project_id=$1 AND g.board_id=b.id AND g.user_id=$2)) ORDER BY b.id`, [projectId, actorId, owner]);
  const digest = createHash('sha256').update(JSON.stringify({ projectId, actorId, owner, role: context.role, grants: grants.rows })).digest('hex');
  const cursor = options.cursor;
  if (cursor && (cursor.projectId !== projectId || cursor.actorId !== actorId || cursor.scopeDigest !== digest)) {
    throw HttpError.conflict('Activity access changed. Refresh and try again.', 'STALE_CURSOR');
  }
  const limit = Math.max(1, Math.min(Number.isSafeInteger(options.limit) ? options.limit! : 50, 100));
  const rows = await client.query<ScopedActivityDraftRow>(
    `SELECT a.id,a.board_id,a.visibility_scope,a.action,a.safe_changes,a.created_at,
       to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
     FROM activity_log a
     WHERE a.project_id=$1 AND ($3::boolean OR
       (a.visibility_scope='board' AND EXISTS (
         SELECT 1 FROM board_grants g JOIN project_memberships m ON m.project_id=g.project_id AND m.user_id=g.user_id AND m.status='active'
         WHERE g.board_id=a.board_id AND g.project_id=a.project_id AND g.user_id=$2)))
       AND ($4::timestamptz IS NULL OR (a.created_at,a.id) < ($4::timestamptz,$5::text))
     ORDER BY a.created_at DESC,a.id DESC LIMIT $6`,
    [projectId, actorId, owner, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1]);
  const items = rows.rows.slice(0, limit), last = items.at(-1);
  return { items, nextCursor: rows.rows.length > limit && last ? { projectId, actorId, scopeDigest: digest, createdAt: last.cursor_time, id: last.id } : null };
}
