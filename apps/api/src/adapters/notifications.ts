import type pg from 'pg';
import type { Notification, NotificationType } from '@flowboard/contracts';
import { getPool } from './postgres.ts';
import { resolveProjectRole } from './rbac.ts';
import { HttpError } from '../http/errors.ts';
import type { Mailer } from '../services/mailer.ts';
import { deliverInvitationRow } from './invitation-delivery.ts';
import { createHash } from 'node:crypto';
import { lockBoardAccess } from './board-grants-foundation.ts';

export interface NotificationCursor {
  v: 2;
  userId: string;
  scopeDigest: string;
  unreadOnly: boolean;
  createdAt: string;
  id: string;
}

export function encodeNotificationCursor(cursor: NotificationCursor): string {
  return btoa(JSON.stringify(cursor))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function decodeNotificationCursor(value: string, expectedUserId: string, scopeDigest: string, unreadOnly: boolean): NotificationCursor {
  try {
    const base64 =
      value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const parsed = JSON.parse(atob(base64)) as Partial<NotificationCursor>;
    if (
      parsed.v !== 2 ||
      parsed.userId !== expectedUserId ||
      parsed.scopeDigest !== scopeDigest ||
      parsed.unreadOnly !== unreadOnly ||
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0
    ) {
      throw new Error('invalid notification cursor');
    }
    return parsed as NotificationCursor;
  } catch {
    throw HttpError.conflict('STALE_CURSOR', 'Notification cursor is invalid or belongs to another user.');
  }
}

async function inNotificationTransaction<T>(db: pg.Pool | pg.ClientBase, run: (client: pg.ClientBase) => Promise<T>): Promise<T> {
  if (typeof (db as pg.Pool).totalCount !== 'number') return run(db as pg.ClientBase);
  const client = await (db as pg.Pool).connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    (client as pg.PoolClient).release();
  }
}

const visibleNotification = `n.user_id=$1 AND EXISTS (
  SELECT 1 FROM projects p JOIN workspaces w ON w.id=p.workspace_id
  WHERE p.id=n.project_id AND p.workspace_id=n.workspace_id AND
    (w.owner_id=$1 OR (
      EXISTS (SELECT 1 FROM project_memberships pm WHERE pm.project_id=p.id AND pm.user_id=$1 AND pm.status='active')
      AND EXISTS (SELECT 1 FROM cards c JOIN boards b ON b.id=c.board_id
        AND b.project_id=c.project_id AND b.workspace_id=c.workspace_id
        JOIN board_grants g ON g.board_id=b.id AND g.project_id=b.project_id
        AND g.workspace_id=b.workspace_id AND g.user_id=$1
        WHERE c.id=n.card_id AND c.project_id=n.project_id AND c.workspace_id=n.workspace_id AND c.state='active')
    ))
)`;

async function notificationScopeDigest(db: pg.ClientBase | pg.Pool, actorId: string): Promise<string> {
  const scope = await db.query<{ project_id: string; board_id: string | null; access_revision: string | null }>(
    `SELECT p.id AS project_id,b.id AS board_id,b.access_revision
     FROM projects p JOIN workspaces w ON w.id=p.workspace_id
     LEFT JOIN boards b ON b.project_id=p.id AND b.workspace_id=p.workspace_id
     WHERE w.owner_id=$1 OR (EXISTS (
       SELECT 1 FROM project_memberships pm WHERE pm.project_id=p.id AND pm.user_id=$1 AND pm.status='active')
       AND b.id IS NOT NULL AND EXISTS (
         SELECT 1 FROM board_grants g WHERE g.board_id=b.id AND g.project_id=p.id AND g.workspace_id=p.workspace_id AND g.user_id=$1))
     ORDER BY p.id,b.id`, [actorId]);
  return createHash('sha256').update(JSON.stringify({ actorId, scope: scope.rows })).digest('hex');
}

export interface ListNotificationsOptions {
  limit?: number | undefined;
  cursor?: string | undefined;
  unreadOnly?: boolean | undefined;
}

export interface ListNotificationsResponse {
  data: Notification[];
  nextCursor: string | null;
}

/**
 * NTF-01: Durable in-app mention inbox. Queries notifications table for current actor with pagination.
 * Filters out ungranted or removed projects so private summaries/titles are never leaked.
 */
export async function listNotifications(
  poolOrClient: pg.Pool | pg.ClientBase,
  actorId: string,
  options?: ListNotificationsOptions,
): Promise<ListNotificationsResponse> {
  return inNotificationTransaction(poolOrClient ?? getPool(), async (client) => {
    const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
    const unreadOnly = options?.unreadOnly === true;
    const scopeDigest = await notificationScopeDigest(client, actorId);
    const cursor = options?.cursor
      ? decodeNotificationCursor(options.cursor, actorId, scopeDigest, unreadOnly) : undefined;
    const result = await client.query<NotificationRow & { cursor_time: string }>(
      `SELECT n.id,n.user_id,n.type,n.title,n.body,n.link,n.read,n.created_at,
         to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
       FROM notifications n
       WHERE ${visibleNotification}
         AND ($2::boolean=FALSE OR n.read=FALSE)
         AND ($3::timestamptz IS NULL OR (n.created_at,n.id)<($3::timestamptz,$4::text))
       ORDER BY n.created_at DESC,n.id DESC LIMIT $5`,
      [actorId, unreadOnly, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      data: rows.map(toNotification),
      nextCursor: result.rows.length > limit && last ? encodeNotificationCursor({
        v: 2, userId: actorId, scopeDigest, unreadOnly,
        createdAt: last.cursor_time, id: last.id,
      }) : null,
    };
  });
}

type NotificationRow = {
  id: string; user_id: string; type: string; title: string; body: string;
  link: string; read: boolean; created_at: Date;
};
function toNotification(row: NotificationRow): Notification {
  return { id: row.id, userId: row.user_id, type: row.type as NotificationType,
    title: row.title, body: row.body, link: row.link, read: Boolean(row.read),
    createdAt: new Date(row.created_at).toISOString() };
}

/** A read marker is committed only while the current board grant is held. */
export async function markNotificationRead(
  poolOrClient: pg.Pool | pg.ClientBase,
  notificationId: string,
  actorId: string,
): Promise<Notification> {
  return inNotificationTransaction(poolOrClient ?? getPool(), async (client) => {
    const context = await client.query<{
      board_id: string | null; project_id: string; workspace_id: string; owner_id: string;
    }>(
      `SELECT c.board_id,n.project_id,n.workspace_id,w.owner_id
       FROM notifications n JOIN projects p ON p.id=n.project_id AND p.workspace_id=n.workspace_id
       JOIN workspaces w ON w.id=p.workspace_id
       LEFT JOIN cards c ON c.id=n.card_id AND c.project_id=n.project_id AND c.workspace_id=n.workspace_id
       WHERE n.id=$1 AND n.user_id=$2`, [notificationId, actorId]);
    const row = context.rows[0];
    if (!row) throw HttpError.notFound('Notification not found.', 'NOT_FOUND');
    if (row.board_id) {
      try {
        const access = await lockBoardAccess(client, row.board_id, actorId);
        if (access.projectId !== row.project_id || access.workspaceId !== row.workspace_id)
          throw HttpError.notFound('Notification not found.', 'NOT_FOUND');
      } catch (error) {
        if (error instanceof HttpError && error.status === 404)
          throw HttpError.notFound('Notification not found.', 'NOT_FOUND');
        throw error;
      }
    } else {
      const owner = await client.query<{ owner_id: string }>(
        'SELECT owner_id FROM workspaces WHERE id=$1 FOR SHARE', [row.workspace_id]);
      if (owner.rows[0]?.owner_id !== actorId)
        throw HttpError.notFound('Notification not found.', 'NOT_FOUND');
    }
    const update = await client.query<NotificationRow>(
      `UPDATE notifications n SET read=TRUE
       WHERE n.id=$2 AND ${visibleNotification}
       RETURNING n.id,n.user_id,n.type,n.title,n.body,n.link,n.read,n.created_at`,
      [actorId, notificationId]);
    const updated = update.rows[0];
    if (!updated) throw HttpError.notFound('Notification not found.', 'NOT_FOUND');
    return toNotification(updated);
  });
}

/** All read markers lock grants in board ID order, then recheck visibility in SQL. */
export async function markAllNotificationsRead(
  poolOrClient: pg.Pool | pg.ClientBase,
  actorId: string,
): Promise<{ count: number }> {
  return inNotificationTransaction(poolOrClient ?? getPool(), async (client) => {
    await client.query(
      `SELECT w.id FROM workspaces w WHERE w.owner_id=$1 AND EXISTS (
        SELECT 1 FROM notifications n JOIN projects p ON p.id=n.project_id
        WHERE n.workspace_id=w.id AND p.workspace_id=w.id AND n.user_id=$1 AND NOT n.read)
       ORDER BY w.id FOR SHARE`, [actorId]);
    const boards = await client.query<{ board_id: string }>(
      `SELECT DISTINCT c.board_id FROM notifications n JOIN cards c ON c.id=n.card_id
       AND c.project_id=n.project_id AND c.workspace_id=n.workspace_id
       WHERE n.user_id=$1 AND NOT n.read AND c.state='active' ORDER BY c.board_id`, [actorId]);
    for (const row of boards.rows) {
      try { await lockBoardAccess(client, row.board_id, actorId); }
      catch (error) {
        if (error instanceof HttpError && error.status === 404) continue;
        throw error;
      }
    }
    const update = await client.query(
      `UPDATE notifications n SET read=TRUE WHERE ${visibleNotification} AND n.read=FALSE`,
      [actorId]);
    return { count: update.rowCount ?? 0 };
  });
}

export interface ProcessOutboxOptions {
  batchSize?: number;
  maxRetries?: number;
  /**
   * The invitation mailer (B-10). Without one, invitation rows stay pending and untouched, and the
   * comment work still runs. Nothing is counted as failed just because mail is not configured.
   */
  mailer?: Mailer | null;
}

export interface ProcessOutboxResult {
  processed: number;
  delivered: number;
  failed: number;
  retried: number;
}

/**
 * NTF-03: Outbox consumer / retry. Leases pending jobs with SKIP LOCKED,
 * delivers mention notifications idempotently, applies exponential backoff on errors,
 * and quarantines jobs after maxRetries.
 */
export async function processOutboxLease(
  pool: pg.Pool,
  options?: ProcessOutboxOptions,
): Promise<ProcessOutboxResult> {
  const batchSize = Math.min(Math.max(options?.batchSize ?? 10, 1), 50);
  const maxRetries = options?.maxRetries ?? 5;
  const mailer = options?.mailer ?? null;

  const client = await pool.connect();
  let processed = 0;
  let delivered = 0;
  let failed = 0;
  let retried = 0;

  try {
    await client.query('BEGIN');

    // 1. Acquire leased jobs using FOR UPDATE SKIP LOCKED
    const leaseRes = await client.query<{
      id: string;
      workspace_id: string;
      project_id: string;
      event_type: string;
      payload: any;
      status: string;
      retry_count: number;
      next_retry_at: Date;
    }>(
      `SELECT id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at
       FROM outbox
       WHERE status IN ('pending', 'processing')
         AND next_retry_at <= NOW()
         AND (event_type <> 'invitation.created' OR $2::boolean)
       ORDER BY next_retry_at ASC, id ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [batchSize, mailer !== null],
    );

    const rows = leaseRes.rows;
    for (const row of rows) {
      processed++;
      try {
        if (row.event_type === 'comment.created') {
          const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
          if (!payload || !payload.cardId || payload.forceFailure) {
            throw new Error('Invalid comment.created outbox payload: cardId is required');
          }
          const { commentId, cardId, authorId, mentions } = payload;

          if (Array.isArray(mentions) && cardId) {
            // Find card & board context
            const cardRes = await client.query<{ title: string; board_id: string }>(
              `SELECT c.title, c.board_id
               FROM cards c
               JOIN boards b ON b.id = c.board_id AND b.project_id = c.project_id AND b.workspace_id = c.workspace_id
               JOIN comments cm ON cm.id = $2 AND cm.card_id = c.id
                 AND cm.project_id = c.project_id AND cm.workspace_id = c.workspace_id
                 AND cm.deleted_at IS NULL
               WHERE c.id = $1 AND c.state = 'active'
                 AND c.project_id = $3 AND c.workspace_id = $4
               FOR SHARE OF c, cm`,
              [cardId, commentId, row.project_id, row.workspace_id],
            );

            if (cardRes.rows.length > 0) {
              const card = cardRes.rows[0]!;
              const notifLink = `/projects/${row.project_id}/boards/${card.board_id}?cardId=${cardId}`;
              const notifTitle = `Mention in ${card.title}`;
              const notifBody = `You were mentioned in a comment on card ${card.title}`;

              for (const targetUserId of mentions) {
                // Self-mention check: do not notify author
                if (targetUserId === authorId) continue;

                // Validate target user has active grant in project
                const targetRole = await resolveProjectRole(row.project_id, targetUserId, client);
                if (!targetRole) continue;

                // Validate target user has active board access (Owner implicit; non-owner needs active board_grant)
                const wsOwnerRes = await client.query<{ owner_id: string }>(
                  'SELECT owner_id FROM workspaces WHERE id = $1',
                  [row.workspace_id],
                );
                const isOwner = wsOwnerRes.rows[0]?.owner_id === targetUserId;
                if (!isOwner) {
                  // The board_grants table is mandatory. If migration 0007 is
                  // missing, this query fails and the transaction rolls back.
                  const grantRes = await client.query<{ board_id: string }>(
                    `SELECT bg.board_id FROM board_grants bg
                     JOIN project_memberships pm ON pm.project_id = bg.project_id AND pm.user_id = bg.user_id AND pm.status = 'active'
                     WHERE bg.board_id = $1 AND bg.user_id = $2`,
                    [card.board_id, targetUserId],
                  );
                  if (grantRes.rows.length === 0) {
                    continue;
                  }
                }

                // Idempotent delivery check
                const existingRes = await client.query<{ id: string }>(
                  `SELECT id FROM notifications
                   WHERE project_id = $1 AND user_id = $2 AND type = 'mention' AND link = $3`,
                  [row.project_id, targetUserId, notifLink],
                );

                if (existingRes.rows.length === 0) {
                  const notifId = 'ntf_' + crypto.randomUUID();
                  await client.query(
                    `INSERT INTO notifications (
                       id, workspace_id, project_id, user_id, type, title, body, link, read, created_at, card_id
                     ) VALUES ($1, $2, $3, $4, 'mention', $5, $6, $7, FALSE, NOW(), $8)`,
                    [notifId, row.workspace_id, row.project_id, targetUserId, notifTitle, notifBody, notifLink, cardId],
                  );
                }
              }
            }
          }
        } else if (row.event_type === 'invitation.created') {
          if (!mailer) continue;
          // deliverInvitationRow records the final status and drops the token itself.
          const outcome = await deliverInvitationRow(client, row, mailer);
          if (outcome.kind === 'retry') {
            throw new Error(`Email delivery failed: ${outcome.reason}`);
          }
          if (outcome.kind === 'delivered') delivered++;
          else failed++;
          continue;
        }

        // Successfully delivered
        await client.query(
          `UPDATE outbox SET status = 'delivered', settled_at = NOW() WHERE id = $1`,
          [row.id],
        );
        delivered++;
      } catch (err) {
        const nextRetry = row.retry_count + 1;
        if (nextRetry >= maxRetries) {
          // Dead-letter quarantine
          await client.query(
            `UPDATE outbox SET status = 'failed', settled_at = NOW(), retry_count = $1 WHERE id = $2`,
            [nextRetry, row.id],
          );
          failed++;
        } else {
          // Exponential backoff
          const backoffSec = Math.pow(2, nextRetry);
          await client.query(
            `UPDATE outbox
             SET status = 'pending',
                 retry_count = $1,
                 next_retry_at = NOW() + ($2 || ' seconds')::interval
             WHERE id = $3`,
            [nextRetry, backoffSec, row.id],
          );
          retried++;
        }
      }
    }

    await client.query('COMMIT');
    return { processed, delivered, failed, retried };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
