-- Keep object keys available for retry after the owning image rows are purged.
CREATE TABLE pending_storage_deletions (
  storage_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token TEXT,
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pending_storage_deletions_retry
  ON pending_storage_deletions(next_retry_at, storage_key);

-- Structured card identity avoids unsafe substring matching on notification links.
ALTER TABLE notifications
  ADD COLUMN card_id TEXT REFERENCES cards(id) ON DELETE SET NULL;

UPDATE notifications
SET card_id = substring(link FROM '[?&]cardId=([^&]+)')
WHERE type = 'mention'
  AND link ~ '[?&]cardId=[^&]+';

CREATE INDEX idx_notifications_card ON notifications(card_id) WHERE card_id IS NOT NULL;
