-- Additive: a plain-text description on each board, and a per-project default landing board.
-- No backfill: existing boards have a NULL description, existing projects a NULL default board.
-- Idempotent: columns use IF NOT EXISTS; constraints are added inside a DO block that ignores
-- "already exists", so a second run changes nothing.

ALTER TABLE boards ADD COLUMN IF NOT EXISTS description TEXT;

-- The composite foreign key below needs a unique target on (id, project_id). boards.id is already
-- unique, so this constraint adds no new rows and only lets the foreign key name both columns.
DO $$
BEGIN
  ALTER TABLE boards ADD CONSTRAINT boards_id_project_id_key UNIQUE (id, project_id);
EXCEPTION
  -- duplicate_table: a UNIQUE constraint's backing index already exists on a re-run.
  WHEN duplicate_object OR duplicate_table THEN NULL;
END
$$;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_board_id TEXT;

-- The pair (default_board_id, id) must match a real board whose project_id is this project's id.
-- So a project can only point at one of its own boards, enforced by PostgreSQL rather than by
-- application code alone. ON DELETE SET NULL (default_board_id) clears only the pointer if the
-- board row is deleted; it never touches the project's id.
DO $$
BEGIN
  ALTER TABLE projects ADD CONSTRAINT projects_default_board_fk
    FOREIGN KEY (default_board_id, id) REFERENCES boards (id, project_id)
    ON DELETE SET NULL (default_board_id);
EXCEPTION
  -- duplicate_object: the named foreign key already exists on a re-run.
  WHEN duplicate_object OR duplicate_table THEN NULL;
END
$$;
