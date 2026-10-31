import type pg from 'pg';
import { HttpError } from '../http/errors.ts';

/**
 * Quota locks and counts for the own-projects limits (B-17, B-18; edge-case review F-02, F-03).
 * Lock order inside one transaction: quota advisory locks first (user, then project), then the
 * existing authorization row locks, then the idempotency replay, then the rate limit, then the count.
 * An advisory lock is only taken before row locks, never upgraded from a row lock, so the order cannot
 * form a cycle with the existing board-then-card order.
 */

export type QuotaScope = 'owned_projects' | 'boards_per_project' | 'members' | 'pending_invitations' | 'owned_projects_total' | 'boards_per_project_total';
export type QuotaRemedy = 'archive_project' | 'archive_board' | 'remove_member' | 'revoke_invitation' | 'none';

/** Serializes every create, reopen and ownership change that counts one user's owned projects. */
export async function lockUserQuota(client: pg.ClientBase, userId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`fb:quota:user:${userId}`]);
}

/** Serializes every board create or reopen, and every invitation or membership change, in one project. */
export async function lockProjectQuota(client: pg.ClientBase, projectId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`fb:quota:project:${projectId}`]);
}

/** Active owned projects across every workspace the user owns. Memberships never count. */
export async function countOwnedActiveProjects(client: pg.Pool | pg.ClientBase, userId: string): Promise<number> {
  const res = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM projects p JOIN workspaces w ON w.id = p.workspace_id
     WHERE w.owner_id = $1 AND p.archived = FALSE`,
    [userId],
  );
  return res.rows[0]?.n ?? 0;
}

/** Active boards in one project, whoever created them. */
export async function countActiveBoards(client: pg.ClientBase, projectId: string): Promise<number> {
  const res = await client.query<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM boards WHERE project_id = $1 AND archived = FALSE',
    [projectId],
  );
  return res.rows[0]?.n ?? 0;
}

export async function countOwnedTotalProjects(client: pg.ClientBase, userId: string): Promise<number> {
  const res = await client.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM projects p JOIN workspaces w ON w.id=p.workspace_id WHERE w.owner_id=$1', [userId]);
  return res.rows[0]?.n ?? 0;
}

export async function countTotalBoards(client: pg.ClientBase, projectId: string): Promise<number> {
  const res = await client.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM boards WHERE project_id=$1', [projectId]);
  return res.rows[0]?.n ?? 0;
}

/** Active members, excluding the Owner (whose membership row, if any, is not a seat). */
export async function countActiveMembers(client: pg.ClientBase, projectId: string): Promise<number> {
  const res = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM project_memberships pm
     JOIN projects p ON p.id = pm.project_id
     JOIN workspaces w ON w.id = p.workspace_id
     WHERE pm.project_id = $1 AND pm.status = 'active' AND pm.user_id <> w.owner_id`,
    [projectId],
  );
  return res.rows[0]?.n ?? 0;
}

/** Pending invitations that have not expired. An expired row still says 'pending' until touched. */
export async function countPendingInvitations(client: pg.ClientBase, projectId: string): Promise<number> {
  const res = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM project_invitations
     WHERE project_id = $1 AND status = 'pending' AND expires_at > NOW()`,
    [projectId],
  );
  return res.rows[0]?.n ?? 0;
}

const MESSAGES: Record<QuotaScope, string> = {
  owned_projects: 'You have reached the limit of active projects you own. Archive a project to free a slot.',
  boards_per_project: 'This project has reached its board limit. Archive a board to free a slot.',
  members: 'This project has reached its member limit. Remove a member to free a slot.',
  pending_invitations: 'This project has reached its limit of pending invitations. Revoke one to free a slot.',
  owned_projects_total: 'You have reached the total number of projects allowed, including archived projects.',
  boards_per_project_total: 'This project has reached the total number of boards allowed, including archived boards.',
};

/**
 * The 409 QUOTA_EXCEEDED error. `current` is passed only when the caller may already see that count;
 * a Manager must not learn a hidden board count (edge-case review F-10).
 */
export function quotaExceeded(scope: QuotaScope, limit: number, remedy: QuotaRemedy, current?: number): HttpError {
  const details: Record<string, unknown> = { scope, limit, remedy };
  if (current !== undefined) details['current'] = current;
  return new HttpError(409, 'QUOTA_EXCEEDED', MESSAGES[scope], details);
}
