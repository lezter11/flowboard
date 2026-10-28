/**
 * Unmounted notification authorization experiment. This is NOT the outbox or
 * a production API. Legacy notifications with no card provenance are hidden
 * from non-owners; no null-card type is assumed to be project-wide safe.
 *
 * Cutover still requires scoped authenticated cursors and revision binding,
 * actual route integration, board-aware outbox, race tests for mark/read and
 * audit, and common lock-order validation against every resource writer.
 */
import type pg from 'pg';
import { lockBoardAccess } from './board-grants-foundation.ts';
import { HttpError } from '../http/errors.ts';

type Queryable = pg.Pool | pg.ClientBase;
export interface DraftNotification { id: string; title: string; body: string; link: string; read: boolean; created_at: Date; cursor_at: string }

// Parameter $1 is the recipient. Card ancestry is checked against both the
// notification's project and workspace before consulting the board grant.
const visible = `n.user_id = $1 AND EXISTS (
  SELECT 1 FROM projects p JOIN workspaces w ON w.id = p.workspace_id
  WHERE p.id = n.project_id AND p.workspace_id = n.workspace_id
    AND (w.owner_id = $1 OR (
      EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'active')
      AND EXISTS (
        SELECT 1 FROM cards c JOIN boards b ON b.id = c.board_id AND b.project_id = c.project_id AND b.workspace_id = c.workspace_id
        JOIN board_grants bg ON bg.board_id = b.id AND bg.project_id = p.id AND bg.workspace_id = p.workspace_id AND bg.user_id = $1
        WHERE c.id = n.card_id AND c.project_id = p.id AND c.workspace_id = p.workspace_id AND c.state = 'active'
      )
    ))
)`;

/** Internal keyset only: not an authenticated or grant-revision-bound API cursor. */
export async function listDraftNotifications(db: Queryable, actorId: string, limit: number, before?: {createdAt: string; id: string}): Promise<DraftNotification[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid limit');
  if (before && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(before.createdAt) || Number.isNaN(Date.parse(before.createdAt)) || !before.id)) throw new Error('Invalid cursor');
  const result = await db.query<DraftNotification>(
    `SELECT n.id, n.title, n.body, n.link, n.read, n.created_at,
       to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
     FROM notifications n
     WHERE ${visible} AND ($2::timestamptz IS NULL OR (n.created_at,n.id) < ($2::timestamptz,$3::text))
     ORDER BY n.created_at DESC, n.id DESC LIMIT $4`,
    [actorId, before?.createdAt ?? null, before?.id ?? null, limit]);
  return result.rows;
}

/**
 * Call inside a transaction and hold authorization locks until commit. A
 * board-specific mark serializes against revocation through the grant row;
 * no notification payload is read before authorization. Unknown legacy rows
 * are available only to the Owner of the notification's own workspace.
 */
export async function markDraftNotificationRead(client: pg.ClientBase, actorId: string, notificationId: string): Promise<boolean> {
  const context = await client.query<{board_id:string|null; owner_id:string}>(
    `SELECT c.board_id, w.owner_id FROM notifications n
     JOIN projects p ON p.id=n.project_id AND p.workspace_id=n.workspace_id
     JOIN workspaces w ON w.id=p.workspace_id
     LEFT JOIN cards c ON c.id=n.card_id AND c.project_id=n.project_id AND c.workspace_id=n.workspace_id
     WHERE n.id=$1 AND n.user_id=$2 FOR SHARE OF w`, [notificationId,actorId]);
  const row=context.rows[0]; if (!row) return false;
  if (row.board_id) {
    try {await lockBoardAccess(client,row.board_id,actorId);}
    catch(e) {if(e instanceof HttpError && e.status===404)return false;throw e;}
  } else if (row.owner_id!==actorId) return false;
  const result = await client.query(`UPDATE notifications n SET read = TRUE WHERE n.id = $2 AND ${visible} RETURNING n.id`, [actorId, notificationId]);
  return Boolean(result.rowCount);
}

/**
 * Call inside a transaction. Locks distinct boards in ascending board_id order
 * to prevent deadlocks and serialize against concurrent grant revocations.
 * Only notifications with active card provenance on authorized boards (or
 * owned workspaces) are updated. Hidden or legacy notifications remain unread.
 */
export async function markAllDraftNotificationsRead(client: pg.ClientBase, actorId: string): Promise<number> {
  const boardsRes = await client.query<{ board_id: string }>(
    `SELECT DISTINCT c.board_id
     FROM notifications n
     JOIN cards c ON c.id = n.card_id AND c.project_id = n.project_id AND c.workspace_id = n.workspace_id
     WHERE n.user_id = $1 AND NOT n.read AND c.state = 'active'
     ORDER BY c.board_id ASC`,
    [actorId],
  );
  for (const row of boardsRes.rows) {
    try {
      await lockBoardAccess(client, row.board_id, actorId);
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) {
        continue;
      }
      throw e;
    }
  }
  const result = await client.query(
    `UPDATE notifications n SET read = TRUE WHERE n.user_id = $1 AND NOT n.read AND ${visible} RETURNING n.id`,
    [actorId],
  );
  return result.rowCount ?? 0;
}

/**
 * Call inside a transaction and retain its locks until commit. Rechecks target
 * board grant at delivery time and locks the parent card/comment before write.
 * Stable caller-supplied ID prevents duplicate inserts only for identical IDs;
 * actual outbox idempotency and transaction ordering require separate review.
 */
export async function insertDraftMention(client: pg.ClientBase, input: {id: string; cardId: string; commentId: string; userId: string; authorId: string}): Promise<boolean> {
  if (input.authorId === input.userId) return false;
  const context = await client.query<{board_id: string; project_id: string; workspace_id: string}>(
    `SELECT c.board_id,c.project_id,c.workspace_id FROM cards c JOIN comments cm ON cm.card_id = c.id
     WHERE c.id = $1 AND cm.id = $2 AND cm.author_id = $3 AND cm.deleted_at IS NULL AND c.state = 'active'`,
    [input.cardId,input.commentId,input.authorId]);
  const c = context.rows[0];
  if (!c) return false;
  try { await lockBoardAccess(client,c.board_id,input.userId); }
  catch (e) { if (e instanceof HttpError && e.status === 404) return false; throw e; }
  const parent = await client.query(`SELECT c.id FROM cards c JOIN comments cm ON cm.card_id = c.id
    WHERE c.id = $1 AND c.board_id = $2 AND c.project_id = $3 AND c.workspace_id = $4 AND c.state = 'active'
      AND cm.id = $5 AND cm.author_id = $6 AND cm.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM comment_mentions m WHERE m.comment_id = cm.id AND m.user_id = $7)
    FOR SHARE OF c, cm`, [input.cardId,c.board_id,c.project_id,c.workspace_id,input.commentId,input.authorId,input.userId]);
  if (!parent.rowCount) return false;
  const result = await client.query(`INSERT INTO notifications (id,workspace_id,project_id,user_id,type,title,body,link,read,created_at,card_id)
    SELECT $1,c.workspace_id,c.project_id,$2,'mention','Mention in ' || c.title,
      'You were mentioned in a comment on card ' || c.title,
      '/projects/' || c.project_id || '/boards/' || c.board_id || '?cardId=' || c.id,FALSE,NOW(),c.id
    FROM cards c JOIN comments cm ON cm.card_id = c.id
    WHERE c.id = $3 AND c.board_id = $4 AND c.project_id = $5 AND c.workspace_id = $6 AND c.state = 'active'
      AND cm.id = $7 AND cm.author_id = $8 AND cm.deleted_at IS NULL
    ON CONFLICT (id) DO NOTHING RETURNING id`,
    [input.id,input.userId,input.cardId,c.board_id,c.project_id,c.workspace_id,input.commentId,input.authorId]);
  return Boolean(result.rowCount);
}
