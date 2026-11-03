-- Retire live columns without deleting source identities referenced by card/import history.
ALTER TABLE columns ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT REFERENCES users(id) ON DELETE RESTRICT;
-- Names are unique among live columns. Historical names remain available for attribution;
-- recreating the same visible name makes a new ID, never revives an old column.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM columns WHERE deleted_at IS NULL GROUP BY board_id,LOWER(BTRIM(name)) HAVING COUNT(*)>1) THEN
    RAISE EXCEPTION 'Active column names conflict under normalization; resolve conflicts before migration0024'
      USING ERRCODE='23505',CONSTRAINT='uq_live_column_normalized_name';
  END IF;
END $$;
ALTER TABLE columns DROP CONSTRAINT IF EXISTS columns_board_id_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_column_normalized_name
  ON columns(board_id,LOWER(BTRIM(name))) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_live_columns_board_position
  ON columns(board_id,position,id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION guard_card_live_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state='active' THEN
    PERFORM 1 FROM columns c WHERE c.id=NEW.column_id AND c.board_id=NEW.board_id
      AND c.project_id=NEW.project_id AND c.workspace_id=NEW.workspace_id AND c.deleted_at IS NULL FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active card requires an active column' USING ERRCODE='23514',CONSTRAINT='card_requires_live_column'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cards_live_column_guard ON cards;
CREATE TRIGGER cards_live_column_guard BEFORE INSERT OR UPDATE OF state,column_id,board_id,project_id,workspace_id ON cards
  FOR EACH ROW EXECUTE FUNCTION guard_card_live_column();

CREATE OR REPLACE FUNCTION guard_column_retirement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    -- App handlers already hold board before column. Direct SQL must prelock the board,
    -- or receive55P03 instead of waiting in the opposite lock order and deadlocking.
    PERFORM 1 FROM boards WHERE id=NEW.board_id FOR UPDATE NOWAIT;
    -- Materialize a new board row version without changing public counters. This makes
    -- stale REPEATABLE READ direct writers fail40001 instead of counting old live columns.
    -- Normal application retirement still owns one version/activity/receipt increment.
    UPDATE boards SET updated_at=updated_at WHERE id=NEW.board_id;
    IF (SELECT COUNT(*) FROM columns WHERE board_id=NEW.board_id AND deleted_at IS NULL)<=1 THEN
      RAISE EXCEPTION 'The final active column cannot be retired' USING ERRCODE='23514',CONSTRAINT='board_requires_live_column';
    END IF;
    IF EXISTS(SELECT 1 FROM cards WHERE column_id=NEW.id AND (state='active' OR (state='trashed' AND restore_until>clock_timestamp()))) THEN
      RAISE EXCEPTION 'Column has active or restorable cards' USING ERRCODE='23514',CONSTRAINT='column_has_live_cards';
    END IF;
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'A retired column cannot be revived' USING ERRCODE='23514',CONSTRAINT='column_retirement_is_final';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS columns_retirement_guard ON columns;
CREATE TRIGGER columns_retirement_guard BEFORE UPDATE OF deleted_at ON columns
  FOR EACH ROW EXECUTE FUNCTION guard_column_retirement();
