-- Additive: fixed-window request counters for the sensitive-route rate limiter (Google sign-in,
-- invitation create, import preview and commit, image upload and finalize). One row per
-- (bucket, client key, one-minute window). UNLOGGED: writes skip the WAL. A crash or restart
-- empties the table, which resets the counters; acceptable for one-minute windows. Rows for ended
-- windows are removed by the scheduled purge in apps/api (adapters/rate-limit-postgres.ts).
CREATE UNLOGGED TABLE IF NOT EXISTS rate_limit_windows (
  bucket TEXT NOT NULL,
  client_key TEXT NOT NULL,
  window_start BIGINT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, client_key, window_start)
);

-- Lets the purge find ended windows by time without scanning the whole table.
CREATE INDEX IF NOT EXISTS rate_limit_windows_window_start_idx ON rate_limit_windows (window_start);
