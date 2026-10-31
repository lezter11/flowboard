-- 0019 (B-21; edge-case review F-02, F-15, F-22, F-27). Additive and idempotent: a second run inserts nothing.
--
-- 1. Personal workspace backfill. Every user who owns no workspace gets one, named with the fixed
--    internal name 'Personal workspace' (F-05; a person's name never becomes a workspace name). Its id is
--    derived from the user id, so the row is the same on every run.
--    The backfill takes the same per-user advisory lock as ensurePersonalWorkspace
--    (hashtext('fb:quota:user:' || id)) and re-checks ownership under it. A sign-in or project create that
--    runs during the migration therefore either finishes first (the backfill then skips the user) or waits.
--    Without the lock, NOT EXISTS alone would not stop a concurrent live sign-in from making a second row.
-- 2. Owner index for counting owned projects and finding a person's workspace (F-27).
-- 3. boards.created_by: who made the board. Nullable, with no backfill: older boards keep NULL (F-22).

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id);

ALTER TABLE boards ADD COLUMN IF NOT EXISTS created_by TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'boards_created_by_fkey' AND conrelid = 'boards'::regclass
  ) THEN
    ALTER TABLE boards ADD CONSTRAINT boards_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
END
$$;

DO $$
DECLARE
  candidate RECORD;
BEGIN
  FOR candidate IN
    SELECT u.id FROM users u
    WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_id = u.id)
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('fb:quota:user:' || candidate.id));
    IF NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.owner_id = candidate.id) THEN
      INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
      VALUES ('ws_' || md5(candidate.id), 'Personal workspace', 'UTC', candidate.id, 1, NOW(), NOW());
    END IF;
  END LOOP;
END
$$;
