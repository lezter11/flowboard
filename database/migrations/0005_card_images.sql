-- Migration 0005: Card images and upload staging extensions
-- Adds dimensions and version tracking to card_images and card_image_uploads

ALTER TABLE card_images
  ADD COLUMN IF NOT EXISTS width INTEGER,
  ADD COLUMN IF NOT EXISTS height INTEGER,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE card_image_uploads
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS received_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS error JSONB;

-- Performance indexes for project scoping and upload cleanup
CREATE INDEX IF NOT EXISTS idx_card_images_project ON card_images(project_id);
CREATE INDEX IF NOT EXISTS idx_card_image_uploads_project ON card_image_uploads(project_id);
CREATE INDEX IF NOT EXISTS idx_card_image_uploads_cleanup ON card_image_uploads(state, expires_at);
