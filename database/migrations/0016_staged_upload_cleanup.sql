-- Additive: marks a staged upload whose staging object has been queued for deletion (B-11), so the
-- orphan sweep settles each row once instead of revisiting it on every run. No backfill: existing
-- rows start as not cleaned, and the first sweep settles them.
-- Idempotent: IF NOT EXISTS everywhere, so a second run changes nothing.
ALTER TABLE card_image_uploads ADD COLUMN IF NOT EXISTS staging_cleaned BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS card_image_uploads_orphan_idx
  ON card_image_uploads (expires_at)
  WHERE staging_cleaned = FALSE;
