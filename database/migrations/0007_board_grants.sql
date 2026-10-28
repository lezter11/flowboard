-- Local foundation only: this migration does not switch existing API authorization.
-- Do not deploy until every board-derived route is converted and independently reviewed.
-- Composite foreign keys enforce board/project/workspace ancestry and require a
-- project membership row. They do NOT enforce an active status, Owner-only
-- grant administration, implicit Owner access, audit, or policy on existing
-- routes. Those invariants require a transaction-aware, mounted application.
-- The membership-status trigger clears stale grants in the same transaction;
-- it does not yet emit per-grant audit events. All writers must follow the
-- documented membership -> grant -> board lock order. Existing routes do not.
ALTER TABLE boards ADD COLUMN access_revision BIGINT NOT NULL DEFAULT 1;

CREATE TABLE board_grants (
  board_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  granted_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id),
  FOREIGN KEY (board_id, project_id, workspace_id)
    REFERENCES boards(id, project_id, workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, user_id)
    REFERENCES project_memberships(project_id, user_id) ON DELETE RESTRICT
);
CREATE INDEX idx_board_grants_project_user ON board_grants(project_id, user_id);

-- A removed membership can later be reactivated, so clear old grants atomically.
-- Membership update takes its row lock before this trigger takes board grant locks.
CREATE FUNCTION clear_board_grants_on_project_removal() RETURNS TRIGGER AS $$
DECLARE affected_board TEXT;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- Order both grant and board locks by stable board ID. Every grant writer
    -- must first lock this membership row, so a concurrent grant for the same
    -- member cannot be inserted or revoked while this trigger is running.
    FOR affected_board IN
      SELECT board_id FROM board_grants
      WHERE project_id = NEW.project_id AND user_id = NEW.user_id
      ORDER BY board_id FOR UPDATE
    LOOP
      UPDATE boards SET access_revision = access_revision + 1 WHERE id = affected_board;
      DELETE FROM board_grants WHERE board_id = affected_board AND user_id = NEW.user_id;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER project_membership_clear_board_grants
  AFTER UPDATE OF status ON project_memberships
  FOR EACH ROW EXECUTE FUNCTION clear_board_grants_on_project_removal();
