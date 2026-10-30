import type pg from 'pg';

/**
 * Settled outbox rows (delivered or failed) are deleted this many days after they settled (B-14,
 * FB-AUD-11). A pending or processing row is never deleted, however old it is.
 */
export const OUTBOX_RETENTION_DAYS = 30;

// COALESCE covers a row that settled before settled_at existed (migration 0017 backfills most of them).
const PURGE_SQL = `
  DELETE FROM outbox
  WHERE id IN (
    SELECT id FROM outbox
    WHERE status IN ('delivered', 'failed')
      AND COALESCE(settled_at, created_at) < NOW() - ($1::int * INTERVAL '1 day')
    ORDER BY COALESCE(settled_at, created_at) ASC, id ASC
    LIMIT $2
    FOR UPDATE SKIP LOCKED
  )`;

/**
 * Deletes one batch of expired settled rows and returns how many were removed. The scheduled
 * handler runs it once per tick; a backlog drains over later ticks.
 */
export async function purgeSettledOutbox(pool: pg.Pool | pg.ClientBase, batchSize = 1000): Promise<number> {
  const limit = Math.min(Math.max(batchSize, 1), 5000);
  const result = await pool.query(PURGE_SQL, [OUTBOX_RETENTION_DAYS, limit]);
  return result.rowCount ?? 0;
}
