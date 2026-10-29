// Per-user "where I left off" pointer: users.last_project_id and users.last_board_id.
//
// The pointer is a convenience, not a permission. Every read re-checks access, so a
// project or board that was revoked, archived or deleted reads as "no location" and its
// id is never returned. Lookups for things the caller cannot read return the same 404 the
// read routes use, so the response does not reveal whether a hidden id exists.
import type pg from 'pg';
import { getPool } from './postgres.ts';
import { HttpError } from '../http/errors.ts';

export interface LastLocation {
  projectId: string;
  boardId: string | null;
}

/**
 * True when the user may read the project, and the board when one is given. Owner access
 * covers every unarchived project and board in the workspace. Other users need an active
 * project membership, plus a board grant for the board. Archived projects and boards are
 * treated as unreadable here.
 */
async function canReadLocation(
  db: pg.Pool | pg.ClientBase,
  userId: string,
  projectId: string,
  boardId: string | null,
): Promise<boolean> {
  const project = await db.query<{ is_owner: boolean; is_member: boolean }>(
    `SELECT (w.owner_id = $2) AS is_owner,
            COALESCE(pm.status = 'active', FALSE) AS is_member
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2
     WHERE p.id = $1 AND p.archived = FALSE`,
    [projectId, userId],
  );
  const row = project.rows[0];
  if (!row || !(row.is_owner || row.is_member)) return false;
  if (boardId === null) return true;

  const board = await db.query(
    `SELECT 1
     FROM boards b
     JOIN workspaces w ON w.id = b.workspace_id
     WHERE b.id = $1 AND b.project_id = $2 AND b.archived = FALSE
       AND (
         w.owner_id = $3
         OR EXISTS (
           SELECT 1 FROM board_grants bg
           WHERE bg.board_id = b.id AND bg.project_id = b.project_id AND bg.user_id = $3
         )
       )`,
    [boardId, projectId, userId],
  );
  return (board.rowCount ?? 0) > 0;
}

/** Read path for GET /session. Returns null when no pointer is set or any part is no longer readable. */
export async function readLastLocation(userId: string, db: pg.Pool = getPool()): Promise<LastLocation | null> {
  const res = await db.query<{ last_project_id: string | null; last_board_id: string | null }>(
    'SELECT last_project_id, last_board_id FROM users WHERE id = $1',
    [userId],
  );
  const row = res.rows[0];
  if (!row?.last_project_id) return null;
  const boardId = row.last_board_id;
  if (!(await canReadLocation(db, userId, row.last_project_id, boardId))) return null;
  return { projectId: row.last_project_id, boardId };
}

/**
 * Write path for PUT /session/last-location. Throws the read routes' 404 when the caller
 * cannot read the target, and writes nothing in that case. The UPDATE only runs when the
 * stored values differ, so repeating the same location does not write a row version.
 */
export async function writeLastLocation(
  userId: string,
  projectId: string,
  boardId: string | null,
  db: pg.Pool = getPool(),
): Promise<LastLocation> {
  if (!(await canReadLocation(db, userId, projectId, boardId))) {
    if (!(await canReadLocation(db, userId, projectId, null))) {
      throw HttpError.notFound('Project not found.', 'NOT_FOUND');
    }
    throw HttpError.notFound('Board not found.', 'NOT_FOUND');
  }

  await db.query(
    `UPDATE users SET last_project_id = $2, last_board_id = $3
     WHERE id = $1
       AND (last_project_id IS DISTINCT FROM $2 OR last_board_id IS DISTINCT FROM $3)`,
    [userId, projectId, boardId],
  );
  return { projectId, boardId };
}
