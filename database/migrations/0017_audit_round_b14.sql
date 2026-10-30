-- Additive (B-14, audit rounds 2 and C). Every statement is idempotent, so a second run changes nothing.
--
-- 1. Child-side indexes for foreign keys that had none (C-06). Without them, deleting a workspace
--    or a user scans these tables for rows that still reference them.
CREATE INDEX IF NOT EXISTS project_links_workspace_idx ON project_links (workspace_id);
CREATE INDEX IF NOT EXISTS board_grants_granted_by_idx ON board_grants (granted_by);

-- 2. Window counters cannot be negative (C-10). Existing rows are checked when the constraint is
--    added: a negative counter would stop it, and such a row cannot come from the API.
DO $$
BEGIN
  ALTER TABLE rate_limit_windows
    ADD CONSTRAINT rate_limit_windows_request_count_nonnegative CHECK (request_count >= 0);
EXCEPTION
  -- duplicate_object: the constraint already exists on a re-run.
  WHEN duplicate_object THEN NULL;
END
$$;

-- 3. Settled outbox rows are purged 30 days after they settled (FB-AUD-11, FB-AUD-09). settled_at
--    records when a row reached delivered or failed. Rows that settled before this migration are
--    backfilled with created_at, which is never later than their real settle time.
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

UPDATE outbox
SET settled_at = created_at
WHERE settled_at IS NULL
  AND status IN ('delivered', 'failed');

CREATE INDEX IF NOT EXISTS outbox_settled_idx
  ON outbox (settled_at)
  WHERE status IN ('delivered', 'failed');

-- 4. Staged upload objects get a random storage key that does not contain the user's filename
--    (FB-AUD-09). The key is stored on the row, so cleanup never rebuilds it from the filename.
--    Rows created before this migration get the key their bytes were stored under.
ALTER TABLE card_image_uploads ADD COLUMN IF NOT EXISTS staging_storage_key TEXT;

UPDATE card_image_uploads
SET staging_storage_key = 'staging/' || id || '/' || filename
WHERE staging_storage_key IS NULL;
