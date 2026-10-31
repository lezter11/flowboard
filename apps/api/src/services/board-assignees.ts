import type pg from 'pg';

/**
 * The one rule for who may be assigned to a card on a board (B-24). Used by the card validator and by the
 * assignee picker, so the two can never disagree:
 * - the workspace owner of the project, always;
 * - an active manager or member of the project who holds an active board grant for that board;
 * - never a viewer, and never a member without a grant.
 * Owners administer grants, so a Manager without a grant is not assignable until the Owner grants the board.
 */
export async function boardAssigneeIds(db: pg.Pool | pg.ClientBase, projectId: string, boardId: string): Promise<Set<string>> {
  const res = await db.query<{ id: string }>(
    `SELECT w.owner_id AS id
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     WHERE p.id = $1
     UNION
     SELECT pm.user_id AS id
     FROM project_memberships pm
     JOIN board_grants bg ON bg.project_id = pm.project_id AND bg.user_id = pm.user_id AND bg.board_id = $2
     WHERE pm.project_id = $1 AND pm.status = 'active' AND pm.role IN ('manager', 'member')`,
    [projectId, boardId],
  );
  return new Set(res.rows.map((row) => row.id));
}

export type AssigneeIneligibilityReason = 'no_board_access' | 'viewer' | 'not_active';

/**
 * Why each refused user cannot be assigned on this board (ERR-R1 S1). Uses the same tables as the rule above,
 * so the reason always matches the decision:
 * - no_board_access: an active manager or member with no active grant on this board;
 * - viewer: an active viewer (never assignable);
 * - not_active: no active membership in the project (left, removed, or never a member).
 * Only ids the rule refuses are returned, in the order given.
 */
export async function assigneeIneligibilityReasons(
  db: pg.Pool | pg.ClientBase,
  projectId: string,
  boardId: string,
  userIds: string[],
): Promise<Array<{ userId: string; reason: AssigneeIneligibilityReason }>> {
  const eligible = await boardAssigneeIds(db, projectId, boardId);
  const refused = userIds.filter((id) => !eligible.has(id));
  if (refused.length === 0) return [];
  const res = await db.query<{ user_id: string; role: string; status: string; granted: boolean }>(
    `SELECT pm.user_id, pm.role, pm.status,
            EXISTS (SELECT 1 FROM board_grants bg
                    WHERE bg.board_id = $2 AND bg.project_id = pm.project_id AND bg.user_id = pm.user_id) AS granted
     FROM project_memberships pm
     WHERE pm.project_id = $1 AND pm.user_id = ANY($3::text[])`,
    [projectId, boardId, refused],
  );
  const byUser = new Map(res.rows.map((r) => [r.user_id, r]));
  return refused.map((userId) => {
    const row = byUser.get(userId);
    if (!row || row.status !== 'active') return { userId, reason: 'not_active' as const };
    if (row.role === 'viewer') return { userId, reason: 'viewer' as const };
    if (!row.granted) return { userId, reason: 'no_board_access' as const };
    return { userId, reason: 'not_active' as const };
  });
}
