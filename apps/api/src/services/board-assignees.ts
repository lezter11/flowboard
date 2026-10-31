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
