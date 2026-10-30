import type pg from 'pg';
import crypto from 'node:crypto';
import { getPool } from '../adapters/postgres.ts';
import { getStorageDriver } from '../adapters/storage.ts';
import { recordActivity } from '../adapters/activity.ts';
import { stagingKeyOf } from '../adapters/images.ts';

export interface PurgeResult {
  claimedCount: number;
  purgedCardIds: string[];
}

export interface PurgeOptions {
  batchSize?: number;
  asOfDate?: Date;
}

/** Retry object deletion from durable keys without holding card/image rows. */
export async function processPendingStorageDeletions(
  clientOrPool?: pg.Pool | pg.ClientBase,
  batchSize = 50,
): Promise<{ deletedCount: number; deferredCount: number }> {
  const pool = clientOrPool ?? getPool();
  const limit = Math.min(Math.max(batchSize, 1), 100);
  let client: pg.ClientBase;
  let shouldRelease = false;
  if ('totalCount' in pool && 'connect' in pool && typeof pool.connect === 'function') {
    client = await pool.connect();
    shouldRelease = true;
  } else {
    client = pool as pg.ClientBase;
  }

  let deletedCount = 0;
  let deferredCount = 0;
  const leaseToken = crypto.randomUUID();
  try {
    await client.query('BEGIN');
    const pending = await client.query<{ storage_key: string; attempts: number }>(
      `SELECT storage_key, attempts FROM pending_storage_deletions
       WHERE next_retry_at <= NOW() AND (lease_until IS NULL OR lease_until <= NOW())
       ORDER BY next_retry_at ASC, storage_key ASC
       LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    for (const item of pending.rows) {
      await client.query(
        `UPDATE pending_storage_deletions
         SET lease_token = $2, lease_until = NOW() + INTERVAL '2 minutes'
         WHERE storage_key = $1`,
        [item.storage_key, leaseToken],
      );
    }
    await client.query('COMMIT');

    // Do network IO outside the claim transaction. Expiring leases recover work
    // if this worker exits before it can persist a success or retry time.
    const storage = getStorageDriver();
    for (const item of pending.rows) {
      try {
        await storage.delete(item.storage_key);
        const deleted = await client.query(
          'DELETE FROM pending_storage_deletions WHERE storage_key = $1 AND lease_token = $2',
          [item.storage_key, leaseToken],
        );
        deletedCount += deleted.rowCount ?? 0;
      } catch {
        const delaySeconds = Math.min(3600, 30 * 2 ** Math.min(item.attempts, 7));
        await client.query(
          `UPDATE pending_storage_deletions
           SET attempts = attempts + 1,
               next_retry_at = NOW() + ($3::text || ' seconds')::interval,
               lease_token = NULL,
               lease_until = NULL,
               last_error = 'storage_delete_failed'
           WHERE storage_key = $1 AND lease_token = $2`,
          [item.storage_key, leaseToken, delaySeconds],
        );
        deferredCount++;
      }
    }
    return { deletedCount, deferredCount };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (shouldRelease && 'release' in client && typeof client.release === 'function') client.release();
  }
}

/**
 * Background purge worker function (DEL-06, FEATURE_SPEC 8 & 9, API.md 121).
 *
 * 1. Claims expired trashed cards using `FOR UPDATE SKIP LOCKED`.
 *    Fencing guarantees that concurrent restores or other worker instances do not race or deadlock.
 * 2. Enforces hard 24h cutoff: cards with `restore_until <= asOfDate`.
 * 3. Transitions state from 'trashed' to 'purged'. If restore has won and committed, the row is active
 *    and not selected.
 * 4. Content scrubbing:
 *    - Clears card title and description to a minimal tombstone
 *    - Clears comments bodies (sets to '')
 *    - Cleans mention notifications (sets body to '[Card content purged]' and link to '#')
 *    - Cleans activity_log safe_changes for this card to minimal tombstones { cardId, purged: true }
 *    - Removes finalized and staging image records only after durable cleanup keys are recorded
 *    - Writes minimal card_purged activity log tombstone
 */
export async function purgeExpiredTrash(
  clientOrPool?: pg.Pool | pg.ClientBase,
  options?: PurgeOptions,
): Promise<PurgeResult> {
  const pool = clientOrPool ?? getPool();
  const batchSize = Math.min(Math.max(options?.batchSize ?? 50, 1), 100);
  const asOfDate = options?.asOfDate ?? new Date();
  const asOfIso = asOfDate.toISOString();

  let client: pg.ClientBase;
  let shouldRelease = false;

  if ('totalCount' in pool && 'connect' in pool && typeof pool.connect === 'function') {
    client = await pool.connect();
    shouldRelease = true;
  } else {
    client = pool as pg.ClientBase;
  }

  try {
    await client.query('BEGIN');

    // 1. Claim expired trashed cards with FOR UPDATE SKIP LOCKED
    const claimRes = await client.query<{
      id: string;
      workspace_id: string;
      project_id: string;
      board_id: string;
      deleted_by: string;
      version: number;
    }>(
      `SELECT id, workspace_id, project_id, board_id, deleted_by, version
       FROM cards
       WHERE state = 'trashed' AND restore_until <= $1
       ORDER BY restore_until ASC, id ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [asOfIso, batchSize],
    );

    const claimed = claimRes.rows;
    if (claimed.length === 0) {
      await client.query('COMMIT');
      // Reuse the already-acquired connection. Scheduled workers intentionally
      // use a one-connection pool, so asking the pool for a second connection
      // here would wait until connectionTimeoutMillis and fail.
      await processPendingStorageDeletions(client, batchSize);
      return { claimedCount: 0, purgedCardIds: [] };
    }

    const purgedCardIds: string[] = [];

    for (const card of claimed) {
      // 2. Fenced transition: only update if still in 'trashed' state
      const updateRes = await client.query<{ id: string }>(
        `UPDATE cards
         SET state = 'purged',
             title = '[Purged card]',
             description = NULL,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $1 AND state = 'trashed'
         RETURNING id`,
        [card.id],
      );

      if (updateRes.rows.length === 0) {
        // Concurrently restored or modified, skip
        continue;
      }

      purgedCardIds.push(card.id);

      // 3. Private content cleanup:
      // a) Scrub comments bodies
      await client.query(
        `UPDATE comments
         SET body = '',
             updated_at = NOW()
         WHERE card_id = $1`,
        [card.id],
      );

      // b) Redact mention notification bodies and invalidate links
      await client.query(
        `UPDATE notifications
         SET title = 'Notification',
             body = '[Card content purged]',
             link = '#'
         WHERE card_id = $1`,
        [card.id],
      );

      // c) Scrub activity log safe_changes for this card to minimal tombstones
      await client.query(
        `UPDATE activity_log
         SET safe_changes = jsonb_build_object('cardId', $1::text, 'purged', true)
         WHERE card_id = $1`,
        [card.id],
      );

      // d) Remove card images records and clean storage objects
      const imgKeysRes = await client.query<{ storage_key: string }>(
        `SELECT storage_key FROM card_images WHERE card_id = $1`,
        [card.id],
      );
      for (const img of imgKeysRes.rows) {
        await client.query(
          `INSERT INTO pending_storage_deletions (storage_key)
           VALUES ($1) ON CONFLICT (storage_key) DO NOTHING`,
          [img.storage_key],
        );
      }

      const uploads = await client.query<{ id: string; filename: string; staging_storage_key: string | null }>(
        `SELECT id, filename, staging_storage_key FROM card_image_uploads WHERE card_id = $1`,
        [card.id],
      );
      for (const upload of uploads.rows) {
        await client.query(
          `INSERT INTO pending_storage_deletions (storage_key)
           VALUES ($1) ON CONFLICT (storage_key) DO NOTHING`,
          [stagingKeyOf(upload)],
        );
      }

      await client.query(`DELETE FROM card_images WHERE card_id = $1`, [card.id]);
      await client.query(`DELETE FROM card_image_uploads WHERE card_id = $1`, [card.id]);

      // e) Record minimal audit tombstone
      await recordActivity(client, {
        workspaceId: card.workspace_id,
        projectId: card.project_id,
        boardId: card.board_id,
        cardId: card.id,
        actorId: card.deleted_by,
        action: 'card_purged',
        safeChanges: { cardId: card.id },
      });
    }

    await client.query('COMMIT');
    await processPendingStorageDeletions(client, batchSize);
    return {
      claimedCount: purgedCardIds.length,
      purgedCardIds,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    if (shouldRelease && 'release' in client && typeof client.release === 'function') {
      client.release();
    }
  }
}
