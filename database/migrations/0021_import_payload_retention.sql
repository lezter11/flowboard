-- Preserve original normalized import data separately from explicit destination mappings.
-- Additive/idempotent. Old uncommitted previews lack their original description/hash/context;
-- expire them rather than guess lost content. Existing cards/duplicate markers are untouched.
ALTER TABLE card_imports
  ADD COLUMN IF NOT EXISTS board_structure_version INTEGER,
  ADD COLUMN IF NOT EXISTS cleanup_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS content_cleaned_at TIMESTAMPTZ;
ALTER TABLE card_import_rows
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS row_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_status TEXT,
  ADD COLUMN IF NOT EXISTS target_column_id TEXT,
  ADD COLUMN IF NOT EXISTS assignee_ids TEXT[];
UPDATE card_imports
SET state = CASE WHEN state IN ('uploaded','validating','ready','invalid') THEN 'expired' ELSE state END,
    cleanup_after = NOW()
WHERE board_structure_version IS NULL AND content_cleaned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_import_content_cleanup
  ON card_imports(cleanup_after, expires_at) WHERE content_cleaned_at IS NULL;
