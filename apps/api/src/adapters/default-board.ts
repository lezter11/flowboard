import type pg from 'pg';

/**
 * Access-safe default landing board for project read models.
 *
 * A project stores one pointer, projects.default_board_id. The pointer is only a hint: it is
 * returned to a caller only when that caller could read the board today. The join below yields
 * dbd.id (the board id) when all of these hold, and NULL otherwise:
 *   - the board still belongs to this project and is not archived;
 *   - the caller is the workspace owner, or holds an explicit board grant right now.
 * A revoked grant therefore reads as NULL, and the stored pointer is left in place.
 *
 * The caller must alias the projects table as `p` and the workspaces table as `w`.
 * actorParam is the SQL placeholder that holds the caller's user id, for example '$2'.
 * It is a trusted constant built by this module, never user input.
 */
export function readableDefaultBoardJoin(actorParam: string): string {
  return `LEFT JOIN boards dbd
            ON dbd.id = p.default_board_id
           AND dbd.project_id = p.id
           AND dbd.archived = FALSE
           AND (w.owner_id = ${actorParam}
                OR EXISTS (
                  SELECT 1 FROM board_grants dbg
                  WHERE dbg.board_id = dbd.id
                    AND dbg.project_id = p.id
                    AND dbg.user_id = ${actorParam}
                ))`;
}

/** Reads one project's landing board id as the given caller may see it, or null. */
export async function readReadableDefaultBoardId(
  client: pg.ClientBase | pg.Pool,
  projectId: string,
  actorId: string,
): Promise<string | null> {
  const res = await client.query<{ default_board_id: string | null }>(
    `SELECT dbd.id AS default_board_id
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     ${readableDefaultBoardJoin('$2')}
     WHERE p.id = $1`,
    [projectId, actorId],
  );
  return res.rows[0]?.default_board_id ?? null;
}
