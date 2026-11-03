import type pg from 'pg';
import { HttpError, validationError } from '../http/errors.ts';
import type { AssigneeIneligibilityReason } from './board-assignees.ts';

/** Only pass a selection within the transaction/client that acquired its row locks. */
export interface LockedAssignees {
  readonly client: pg.ClientBase;
  readonly projectId: string;
  readonly boardId: string;
  readonly userIds: readonly string[];
  readonly reasons: ReadonlyArray<{ userId: string; reason: AssigneeIneligibilityReason }>;
}

/**
 * Actor authorization precedes this helper. Recipient membership SHARE locks, then grant SHARE
 * locks, precede the board ordering lock. Membership removal/demotion takes UPDATE; grant
 * mutation takes membership SHARE → grant UPDATE → board UPDATE. Locks remain until commit.
 * Capture missing/ineligible rows too: a later insert must not escape this locked selection.
 * Workspace ownership is guarded by SHARE so Owner inheritance cannot change underneath it.
 */
export async function lockSelectedAssignees(
  client: pg.ClientBase, projectId: string, boardId: string, userIds: string[],
): Promise<LockedAssignees> {
  if (userIds.length > 20 || new Set(userIds).size !== userIds.length) {
    throw validationError('Provide at most 20 unique assignees.', { issues: [{ path: 'assigneeIds', message: 'At most 20 unique assignees are allowed' }] });
  }
  if (!userIds.length) return { client,projectId,boardId,userIds: [],reasons: [] };
  const owner = await client.query<{ owner_id: string }>(
    `SELECT w.owner_id FROM projects p JOIN workspaces w ON w.id=p.workspace_id
     JOIN boards b ON b.project_id=p.id AND b.workspace_id=p.workspace_id
     WHERE p.id=$1 AND b.id=$2 FOR SHARE OF w`, [projectId, boardId],
  );
  if (!owner.rows[0]) throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  const ids = [...userIds].sort();
  const memberships = await client.query<{ user_id: string; role: string; status: string }>(
    `SELECT user_id,role,status FROM project_memberships
     WHERE project_id=$1 AND user_id=ANY($2::text[]) ORDER BY user_id FOR SHARE`, [projectId, ids],
  );
  const grants = await client.query<{ user_id: string }>(
    `SELECT user_id FROM board_grants WHERE project_id=$1 AND board_id=$2 AND user_id=ANY($3::text[])
     ORDER BY user_id FOR SHARE`, [projectId, boardId, ids],
  );
  const byUser = new Map(memberships.rows.map(row => [row.user_id,row]));
  const granted = new Set(grants.rows.map(row => row.user_id));
  const reasons: Array<{ userId: string; reason: AssigneeIneligibilityReason }> = [];
  for (const userId of userIds) {
    if (userId === owner.rows[0].owner_id) continue;
    const membership = byUser.get(userId);
    if (!membership || membership.status !== 'active') reasons.push({ userId, reason: 'not_active' });
    else if (membership.role === 'viewer') reasons.push({ userId, reason: 'viewer' });
    else if (!granted.has(userId)) reasons.push({ userId, reason: 'no_board_access' });
  }
  return { client, projectId, boardId, userIds: [...userIds], reasons };
}

/** Replays only reauthorize the actor; apply recipient eligibility to new writes, after replay. */
export function validateLockedAssignees(
  selection: LockedAssignees, client: pg.ClientBase, projectId: string, boardId: string, userIds: string[],
): void {
  if (selection.client !== client || selection.projectId !== projectId || selection.boardId !== boardId ||
      selection.userIds.length !== userIds.length || selection.userIds.some((id,index) => id !== userIds[index])) {
    throw new Error('Assignee lock selection does not match its transaction and request');
  }
  if (!selection.reasons.length) return;
  const invalidUsers = selection.reasons.map(row => row.userId);
  throw new HttpError(422, 'ASSIGNEE_NOT_ELIGIBLE', 'All assignees must be active owners, managers or members with access to this board.', {
    boardId, reasons: selection.reasons, ineligibleUserIds: invalidUsers, invalidAssigneeIds: invalidUsers,
    issues: [{ path: 'assigneeIds', message: `Users are not eligible assignees (active owner, manager or member with board access): ${invalidUsers.join(', ')}` }],
  });
}
