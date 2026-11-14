CREATE TABLE card_documents (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  filename TEXT CHECK (char_length(filename) BETWEEN 5 AND 160),
  byte_length INTEGER CHECK (byte_length BETWEEN 1 AND 1048576),
  original_byte_length INTEGER CHECK (original_byte_length BETWEEN byte_length AND 1048576),
  sha256 TEXT CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  storage_key TEXT UNIQUE CHECK (storage_key ~ '^documents/[a-f0-9-]{36}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  deleted_at TIMESTAMPTZ,
  CHECK (
    (deleted_at IS NULL AND filename IS NOT NULL AND byte_length IS NOT NULL
      AND original_byte_length IS NOT NULL AND sha256 IS NOT NULL AND storage_key IS NOT NULL)
    OR (deleted_at IS NOT NULL AND filename IS NULL AND byte_length IS NULL
      AND original_byte_length IS NULL AND sha256 IS NULL AND storage_key IS NULL)
  ),
  FOREIGN KEY (card_id, project_id, workspace_id) REFERENCES cards(id, project_id, workspace_id) ON DELETE RESTRICT
);

CREATE INDEX idx_card_documents_gallery ON card_documents (card_id, created_at, id) WHERE deleted_at IS NULL;
CREATE INDEX idx_card_documents_tombstones ON card_documents (deleted_at, id) WHERE deleted_at IS NOT NULL;

-- A new key for each physical put. An expired slot can release its idempotency key
-- before it is safe for a janitor to delete its crash-ambiguous storage object.
CREATE TABLE card_document_reservations (
  storage_key TEXT PRIMARY KEY CHECK (storage_key ~ '^documents/[a-f0-9-]{36}$'),
  card_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key TEXT,
  payload_sha256 TEXT NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + INTERVAL '2 minutes'),
  reclaim_at TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + INTERVAL '24 hours'),
  FOREIGN KEY (card_id, project_id, workspace_id) REFERENCES cards(id, project_id, workspace_id) ON DELETE RESTRICT,
  UNIQUE (project_id, uploader_id, idempotency_key),
  CHECK (reclaim_at >= expires_at)
);

CREATE INDEX idx_document_reservations_capacity ON card_document_reservations (card_id, expires_at);
CREATE INDEX idx_document_reservations_reclaim ON card_document_reservations (reclaim_at, storage_key);

-- Trash remains recoverable. Only the established transition to a purged tombstone
-- removes document metadata and enqueues the durable object keys in the same transaction.
CREATE FUNCTION enqueue_purged_card_documents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  WITH removed AS (
    DELETE FROM card_documents WHERE card_id = NEW.id RETURNING storage_key
  )
  INSERT INTO pending_storage_deletions (storage_key)
    SELECT storage_key FROM removed WHERE storage_key IS NOT NULL ON CONFLICT (storage_key) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER purge_card_documents
AFTER UPDATE OF state ON cards FOR EACH ROW
WHEN (OLD.state IS DISTINCT FROM NEW.state AND NEW.state = 'purged')
EXECUTE FUNCTION enqueue_purged_card_documents();
