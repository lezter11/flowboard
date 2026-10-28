/**
 * Unmounted board-access foundation. Call only in an explicit transaction.
 * Existing routes do not use this module: it is NOT authorization cutover.
 * Lock order: workspace ownership row FOR SHARE, target project membership
 * FOR SHARE, then an existing board grant FOR SHARE (access) or FOR UPDATE
 * (mutation), followed by the board revision row FOR UPDATE. The board row
 * also serializes mutations where the grant does not exist. Project membership
 * removal locks membership and then processes grants/boards in ascending board
 * ID order. Route callers must acquire authorization locks BEFORE any resource
 * locks and retain them through commit. Multi-board operations must use the
 * same ascending order; existing routes do not yet follow or prove this rule.
 * Transfer/archival paths, activity visibility, and per-grant audit on project
 * membership removal remain unvalidated by this foundation.
 */
import type pg from 'pg';
import type { Role, ProjectRole } from '@flowboard/contracts';
import { HttpError } from '../http/errors.ts';
import { recordActivity } from './activity.ts';

const unavailable = () => HttpError.notFound('Board not found.', 'NOT_FOUND');

/** Acquires workspace ownership guard, membership guard and grant guard, in that order. */
export async function lockBoardAccess(
  client: pg.ClientBase, boardId: string, actorId: string,
): Promise<{ role: Role; projectId: string; workspaceId: string }> {
  const context = await client.query<{ project_id: string; workspace_id: string; owner_id: string }>(
    `SELECT b.project_id, b.workspace_id, w.owner_id FROM boards b
     JOIN projects p ON p.id = b.project_id AND p.workspace_id = b.workspace_id
     JOIN workspaces w ON w.id = p.workspace_id WHERE b.id = $1 FOR SHARE OF w`, [boardId],
  );
  const row = context.rows[0];
  if (!row) throw unavailable();
  if (row.owner_id === actorId) return { role: 'owner', projectId: row.project_id, workspaceId: row.workspace_id };
  const member = await client.query<{ role: ProjectRole; status: string }>(
    'SELECT role, status FROM project_memberships WHERE project_id = $1 AND user_id = $2 FOR SHARE',
    [row.project_id, actorId],
  );
  if (member.rows[0]?.status !== 'active') throw unavailable();
  const grant = await client.query<{ board_id: string }>(
    'SELECT board_id FROM board_grants WHERE board_id = $1 AND project_id = $2 AND user_id = $3 FOR SHARE',
    [boardId, row.project_id, actorId],
  );
  if (!grant.rows[0]) throw unavailable();
  return { role: member.rows[0]!.role, projectId: row.project_id, workspaceId: row.workspace_id };
}

/**
 * Freeze the accessible board set for one project read. Call inside a
 * READ COMMITTED transaction and keep it open through response assembly.
 * null means the workspace Owner, who sees every board in the project.
 */
export async function lockProjectBoardReadScope(
  client: pg.ClientBase, projectId: string, actorId: string,
): Promise<string[] | null> {
  const project = await client.query<{ workspace_id: string; owner_id: string }>(
    `SELECT p.workspace_id, w.owner_id FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     WHERE p.id = $1 FOR SHARE OF w`, [projectId],
  );
  if (!project.rows[0]) throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  if (project.rows[0].owner_id === actorId) return null;
  const membership = await client.query<{ status: string }>(
    `SELECT status FROM project_memberships
     WHERE project_id = $1 AND user_id = $2 FOR SHARE`, [projectId, actorId],
  );
  if (membership.rows[0]?.status !== 'active') throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  const grants = await client.query<{ board_id: string }>(
    `SELECT bg.board_id FROM board_grants bg
     JOIN boards b ON b.id = bg.board_id AND b.project_id = bg.project_id AND b.workspace_id = bg.workspace_id
     WHERE bg.project_id = $1 AND bg.workspace_id = $2 AND bg.user_id = $3
     ORDER BY bg.board_id FOR SHARE OF bg`,
    [projectId, project.rows[0].workspace_id, actorId],
  );
  return grants.rows.map((row) => row.board_id);
}

/** Lock before any grant change. The workspace owner is the sole administrator. */
async function lockOwnerAndMember(client: pg.ClientBase, boardId: string, actorId: string, targetId: string) {
  const context = await client.query<{ project_id: string; workspace_id: string; owner_id: string }>(
    `SELECT b.project_id, b.workspace_id, w.owner_id FROM boards b
     JOIN projects p ON p.id = b.project_id AND p.workspace_id = b.workspace_id
     JOIN workspaces w ON w.id = p.workspace_id WHERE b.id = $1 FOR SHARE OF w`, [boardId],
  );
  const row = context.rows[0];
  if (!row || row.owner_id !== actorId || targetId === row.owner_id) throw unavailable();
  const member = await client.query<{ status: string }>(
    'SELECT status FROM project_memberships WHERE project_id = $1 AND user_id = $2 FOR SHARE',
    [row.project_id, targetId],
  );
  if (member.rows[0]?.status !== 'active') throw unavailable();
  return row;
}

/**
 * Changes one board grant in a transaction. expectedAccessRevision must come
 * from the client's last authorized access-list read, not a server-side refresh
 * immediately before mutation. A stale revision fails even for an apparent
 * no-op; otherwise a delayed grant could undo a later revocation.
 * Callers must roll back on 409 STALE_ACCESS_REVISION and refetch/review.
 * Idempotency receipts must bind request payload and reauthorize before replay;
 * this helper alone does not implement retry receipts.
 */
export async function changeBoardGrant(
  client: pg.ClientBase, boardId: string, actorId: string, targetId: string, allow: boolean, expectedAccessRevision: bigint,
): Promise<boolean> {
  const row = await lockOwnerAndMember(client, boardId, actorId, targetId);
  await client.query('SELECT board_id FROM board_grants WHERE board_id = $1 AND project_id = $2 AND user_id = $3 FOR UPDATE',
    [boardId, row.project_id, targetId]);
  const revision = await client.query<{ access_revision: string }>(
    'SELECT access_revision FROM boards WHERE id = $1 AND project_id = $2 AND workspace_id = $3 FOR UPDATE',
    [boardId, row.project_id, row.workspace_id]);
  if (!revision.rows[0]) throw unavailable();
  if (BigInt(revision.rows[0].access_revision) !== expectedAccessRevision) {
    throw HttpError.conflict('Board access changed. Refresh and try again.', 'STALE_ACCESS_REVISION');
  }
  const result = allow
    ? await client.query(`INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (board_id, user_id) DO NOTHING RETURNING board_id`,
      [boardId, row.project_id, row.workspace_id, targetId, actorId])
    : await client.query('DELETE FROM board_grants WHERE board_id = $1 AND project_id = $2 AND user_id = $3 RETURNING board_id',
      [boardId, row.project_id, targetId]);
  if (!result.rowCount) return false;
  await client.query('UPDATE boards SET access_revision = access_revision + 1 WHERE id = $1', [boardId]);
  await recordActivity(client, {
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    boardId,
    visibilityScope: 'board',
    actorId,
    action: allow ? 'board_access_granted' : 'board_access_revoked',
    safeChanges: { boardId, userId: targetId },
  });
  return true;
}
