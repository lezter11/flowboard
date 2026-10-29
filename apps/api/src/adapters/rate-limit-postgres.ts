import type pg from 'pg';
import type { WindowCount, WindowCounter, WindowBucket } from '../services/rate-limit.ts';

// One atomic statement per limited request. The upsert locks the (bucket, key, window) row, so
// concurrent requests are counted exactly once each. Time comes from the database clock, so
// every Worker agrees on the window boundaries. Parameterized SQL only.
const CONSUME_SQL = `
WITH clock AS (
  SELECT floor(extract(epoch FROM now()))::bigint AS now_s
),
win AS (
  SELECT (now_s - now_s % $3::bigint)::bigint AS window_start, now_s FROM clock
),
upserted AS (
  INSERT INTO rate_limit_windows (bucket, client_key, window_start, request_count)
  SELECT $1::text, $2::text, window_start, 1 FROM win
  ON CONFLICT (bucket, client_key, window_start)
  DO UPDATE SET request_count = rate_limit_windows.request_count + 1
  RETURNING request_count, window_start
)
SELECT upserted.request_count, upserted.window_start, win.now_s
FROM upserted, win`;

interface ConsumeRow {
  request_count: number;
  window_start: string;
  now_s: string;
}

export async function consumeWindow(
  pool: pg.Pool | pg.ClientBase,
  bucket: WindowBucket,
  clientKey: string,
  windowSeconds: number,
): Promise<WindowCount> {
  const result = await pool.query<ConsumeRow>(CONSUME_SQL, [bucket, clientKey, windowSeconds]);
  const row = result.rows[0];
  if (!row) throw new Error('rate limit upsert returned no row');
  const windowEnd = Number(row.window_start) + windowSeconds;
  return {
    count: Number(row.request_count),
    retryAfterSeconds: Math.max(1, windowEnd - Number(row.now_s)),
  };
}

export function postgresWindowCounter(pool: pg.Pool | pg.ClientBase): WindowCounter {
  return {
    consume: (bucket, clientKey, windowSeconds) => consumeWindow(pool, bucket, clientKey, windowSeconds),
  };
}

// Deletes windows that have ended, in bounded batches. Safe to repeat: each run removes only
// rows whose window has already ended, so a second run after no new windows deletes nothing.
const PURGE_SQL = `
DELETE FROM rate_limit_windows
WHERE ctid IN (
  SELECT ctid FROM rate_limit_windows
  WHERE window_start + $1::bigint <= floor(extract(epoch FROM now()))::bigint
  LIMIT $2::int
)`;

export async function purgeEndedWindows(
  pool: pg.Pool | pg.ClientBase,
  maxWindowSeconds = 60,
  batchSize = 5000,
): Promise<number> {
  const result = await pool.query(PURGE_SQL, [maxWindowSeconds, batchSize]);
  return result.rowCount ?? 0;
}
