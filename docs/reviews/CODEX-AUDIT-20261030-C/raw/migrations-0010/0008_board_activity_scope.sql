-- EXPERIMENTAL: never auto-applied; all activity writers and reads must be
-- cut over atomically. Unclassified legacy records stay Owner-only.
ALTER TABLE activity_log ADD COLUMN board_id TEXT;
ALTER TABLE activity_log ADD COLUMN visibility_scope TEXT NOT NULL DEFAULT 'unknown'
  CHECK (visibility_scope IN ('unknown', 'project', 'board'));

-- Existing card-linked events have verified card ancestry. Cardless legacy
-- events are deliberately left unknown rather than trusting arbitrary JSON.
UPDATE activity_log a SET board_id = c.board_id, visibility_scope = 'board'
FROM cards c
WHERE a.card_id = c.id AND a.project_id = c.project_id AND a.workspace_id = c.workspace_id;

ALTER TABLE activity_log ADD CONSTRAINT activity_scope_board_fk
  FOREIGN KEY (board_id, project_id, workspace_id)
  REFERENCES boards(id, project_id, workspace_id) ON DELETE RESTRICT;
ALTER TABLE activity_log ADD CONSTRAINT activity_scope_shape
  CHECK ((visibility_scope = 'board' AND board_id IS NOT NULL)
      OR (visibility_scope IN ('unknown', 'project') AND board_id IS NULL));

-- Prevent marking a board/card event as a project event. The scope remains
-- attached to historical events when the card reference is nulled on deletion.
CREATE FUNCTION validate_activity_scope_draft() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.board_id IS DISTINCT FROM OLD.board_id OR NEW.visibility_scope IS DISTINCT FROM OLD.visibility_scope) THEN
    RAISE EXCEPTION 'activity scope is immutable';
  END IF;
  IF NEW.card_id IS NOT NULL AND NEW.visibility_scope <> 'unknown' AND NOT EXISTS (
    SELECT 1 FROM cards c WHERE c.id = NEW.card_id AND c.board_id = NEW.board_id
      AND c.project_id = NEW.project_id AND c.workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'activity card scope does not match';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER validate_activity_scope_draft_trigger
  BEFORE INSERT OR UPDATE ON activity_log FOR EACH ROW EXECUTE FUNCTION validate_activity_scope_draft();

CREATE INDEX idx_activity_scope_draft_page ON activity_log(project_id, created_at DESC, id DESC);
