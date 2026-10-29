-- Additive: remember where each user last was, so the app can return them there.
-- Both columns are pointers only. Access is re-checked on every read (see
-- apps/api/src/adapters/last-location.ts); a pointer to a project or board the user
-- can no longer read is never returned. ON DELETE SET NULL clears a pointer when its
-- target row is deleted. No backfill: existing users start with NULL.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_board_id TEXT REFERENCES boards(id) ON DELETE SET NULL;
