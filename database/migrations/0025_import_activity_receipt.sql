-- Bounded persisted provenance lookup; legacy batches without a fact remain unknown.
CREATE INDEX IF NOT EXISTS idx_import_commit_activity_receipt
  ON activity_log(project_id,workspace_id,board_id,(safe_changes->>'importId'),created_at,id)
  WHERE action='card_import_committed';
