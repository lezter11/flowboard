import type pg from 'pg';
import type { ProjectOverview } from '@flowboard/contracts';
import { HttpError } from '../http/errors.ts';
import { getWorkspaceToday } from './boards.ts';

/**
 * GET /projects/:pid/overview: real counts for a project's dashboard.
 *
 * Who may read: the workspace owner, or any active project member (manager, member or viewer).
 * Which boards count: only boards the caller can read. The workspace owner reads every board in
 * the project. Anyone else reads a board only with an explicit board grant. The rule is written
 * once, in the `readable` CTE below, and every aggregate joins to it. Archived boards are left out
 * for everyone, matching the board list.
 *
 * Privacy: an unreadable board contributes nothing, not even to a total, so its name, id and card
 * counts never reach the response. Nothing is estimated: each number is a COUNT over real rows.
 *
 * Definitions (same as the board snapshot):
 *   - open: the card's column is not in the 'done' category;
 *   - overdue: open, with a due date before the workspace's today;
 *   - due soon: open, due from today to seven days later, inclusive;
 *   - unassigned open: open with no assignee.
 *
 * Recent activity: board-scoped rows on readable boards, plus project-scope rows (member, invitation,
 * brief and links events) for the owner and managers only (B-6). Members and viewers never see
 * project rows. Unscoped legacy rows are never shown. Token and invitee email are never logged, so
 * they cannot appear here.
 *
 * All reads run in one REPEATABLE READ, READ ONLY transaction, so the numbers describe one moment.
 */

const READABLE_BOARDS = `
  readable AS (
    SELECT b.id
    FROM boards b
    JOIN workspaces w ON w.id = b.workspace_id
    WHERE b.project_id = $1
      AND b.archived = FALSE
      AND (
        w.owner_id = $2
        OR EXISTS (
          SELECT 1 FROM board_grants g
          WHERE g.board_id = b.id AND g.project_id = b.project_id AND g.user_id = $2
        )
      )
  )`;

export async function getProjectOverview(
  pool: pg.Pool,
  projectId: string,
  actorId: string,
): Promise<ProjectOverview> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

    // 1. Project access: the workspace owner or an active member. Anyone else gets 404.
    const ctx = await client.query<{ owner_id: string; timezone: string; role: string | null }>(
      `SELECT w.owner_id, w.timezone, pm.role
       FROM projects p
       JOIN workspaces w ON w.id = p.workspace_id
       LEFT JOIN project_memberships pm
         ON pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
       WHERE p.id = $1`,
      [projectId, actorId],
    );
    const row = ctx.rows[0];
    if (!row || (row.owner_id !== actorId && !row.role)) {
      throw HttpError.notFound('Project not found.', 'NOT_FOUND');
    }
    const today = getWorkspaceToday(row.timezone);

    // 2. How many boards the caller can read. This is the caller's own view, not a leak.
    const boardCount = await client.query<{ n: string }>(
      `WITH ${READABLE_BOARDS} SELECT COUNT(*)::text AS n FROM readable`,
      [projectId, actorId],
    );

    // 3. Card counts per column category, plus overdue, due soon and unassigned, in one pass.
    const cardRows = await client.query<{
      category: 'todo' | 'active' | 'done';
      active: string;
      overdue: string;
      due_soon: string;
      unassigned_open: string;
    }>(
      `WITH ${READABLE_BOARDS}
       SELECT col.category,
              COUNT(*)::text AS active,
              COUNT(*) FILTER (WHERE c.due_date < $3::date AND col.category <> 'done')::text AS overdue,
              COUNT(*) FILTER (
                WHERE c.due_date >= $3::date AND c.due_date <= ($3::date + 7) AND col.category <> 'done'
              )::text AS due_soon,
              COUNT(*) FILTER (
                WHERE col.category <> 'done'
                  AND NOT EXISTS (SELECT 1 FROM card_assignees ca WHERE ca.card_id = c.id)
              )::text AS unassigned_open
       FROM cards c
       JOIN readable r ON r.id = c.board_id
       JOIN columns col ON col.id = c.column_id
       WHERE c.project_id = $1 AND c.state = 'active'
       GROUP BY col.category`,
      [projectId, actorId, today],
    );

    const byCategory = { todo: 0, active: 0, done: 0 };
    let active = 0;
    let overdue = 0;
    let dueSoon = 0;
    let unassignedOpen = 0;
    for (const r of cardRows.rows) {
      byCategory[r.category] = Number(r.active);
      active += Number(r.active);
      overdue += Number(r.overdue);
      dueSoon += Number(r.due_soon);
      unassignedOpen += Number(r.unassigned_open);
    }

    // 4. Open cards per assignee, on readable boards only. Bounded to 50 people.
    const assigneeRows = await client.query<{
      user_id: string;
      display_name: string;
      avatar_url: string | null;
      open_count: string;
    }>(
      `WITH ${READABLE_BOARDS}
       SELECT u.id AS user_id, u.display_name, u.avatar_url, COUNT(*)::text AS open_count
       FROM card_assignees ca
       JOIN cards c ON c.id = ca.card_id AND c.state = 'active' AND c.project_id = $1
       JOIN readable r ON r.id = c.board_id
       JOIN columns col ON col.id = c.column_id AND col.category <> 'done'
       JOIN users u ON u.id = ca.user_id
       GROUP BY u.id, u.display_name, u.avatar_url
       ORDER BY COUNT(*) DESC, u.id ASC
       LIMIT 50`,
      [projectId, actorId],
    );

    // 5. The last 10 activity rows: board rows on readable boards, plus project-scope rows (member,
    // invitation, brief and links events) for the owner and managers only. Members and viewers never
    // get project rows. One query; the project-row branch is a flag computed from the access check.
    const canSeeProjectRows = row.owner_id === actorId || row.role === 'manager';
    const activityRows = await client.query<{
      id: string;
      action: string;
      card_id: string | null;
      created_at: Date;
      actor_id: string;
      actor_name: string;
    }>(
      `WITH ${READABLE_BOARDS}
       SELECT a.id, a.action, a.card_id, a.created_at, a.actor_id, u.display_name AS actor_name
       FROM activity_log a
       JOIN users u ON u.id = a.actor_id
       WHERE a.project_id = $1
         AND (
           (a.visibility_scope = 'board' AND a.board_id IN (SELECT id FROM readable))
           OR (a.visibility_scope = 'project' AND $3::boolean)
         )
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 10`,
      [projectId, actorId, canSeeProjectRows],
    );

    await client.query('COMMIT');

    return {
      projectId,
      asOfDate: today,
      readableBoardCount: Number(boardCount.rows[0]?.n ?? 0),
      cards: {
        active,
        byCategory,
        overdue,
        dueSoon,
        unassignedOpen,
      },
      assignees: assigneeRows.rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        openCount: Number(r.open_count),
      })),
      recentActivity: activityRows.rows.map((r) => ({
        id: r.id,
        action: r.action,
        cardId: r.card_id,
        createdAt: new Date(r.created_at).toISOString(),
        actor: { id: r.actor_id, displayName: r.actor_name },
      })),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
