-- Flowboard PostgreSQL Schema Migration 0001
-- PostgreSQL 17 compatible DDL

-- 1. workspaces
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 2. users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 3. projects
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 4. project_memberships
CREATE TABLE project_memberships (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('manager', 'member', 'viewer')),
  status TEXT NOT NULL CHECK (status IN ('active', 'removed')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(project_id, user_id)
);

-- 5. project_invitations
CREATE TABLE project_invitations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('manager', 'member', 'viewer')),
  token_hash TEXT NOT NULL,
  invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 6. boards
CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  structure_version INTEGER NOT NULL DEFAULT 1,
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 7. columns
CREATE TABLE columns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('todo', 'active', 'done')),
  position INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(board_id, name)
);

-- 8. cards
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,
  column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('none', 'low', 'medium', 'high', 'urgent')),
  due_date DATE,
  position BIGINT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL CHECK (state IN ('active', 'trashed', 'purged')),
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  restore_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 9. card_assignees
CREATE TABLE card_assignees (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(card_id, user_id)
);

-- 10. comments
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 11. comment_mentions
CREATE TABLE comment_mentions (
  id TEXT PRIMARY KEY,
  comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

-- 12. activity_log
CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  safe_changes JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

-- 13. notifications
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL
);

-- 14. card_images
CREATE TABLE card_images (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  filename TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 15. card_image_uploads
CREATE TABLE card_image_uploads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  filename TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('awaiting_content', 'content_received', 'validating', 'finalized', 'failed', 'cancelled', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  finalized_image_id TEXT REFERENCES card_images(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 16. card_imports
CREATE TABLE card_imports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,
  default_column_id TEXT NOT NULL REFERENCES columns(id) ON DELETE RESTRICT,
  uploader_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL CHECK (state IN ('uploaded', 'validating', 'invalid', 'ready', 'committing', 'committed', 'failed', 'cancelled', 'expired')),
  preview_digest TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

-- 17. card_import_rows
CREATE TABLE card_import_rows (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES card_imports(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT,
  priority TEXT,
  due_date DATE,
  assignee_emails TEXT[],
  outcome TEXT NOT NULL CHECK (outcome IN ('new', 'already_imported', 'invalid', 'conflict', 'created', 'skipped')),
  errors JSONB,
  card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL
);

-- 18. card_import_duplicates
CREATE TABLE card_import_duplicates (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE RESTRICT,
  external_id TEXT NOT NULL,
  card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
  row_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(board_id, external_id)
);

-- 19. idempotency_receipts
CREATE TABLE idempotency_receipts (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('workspace', 'project', 'actor')),
  scope_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  method_path_hash TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(actor_id, scope_id, idempotency_key)
);

-- 20. outbox
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'delivered', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

-- 21. schema_migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL
);

-- Performance and Foreign Key Indexes
CREATE INDEX idx_projects_workspace ON projects(workspace_id);
CREATE INDEX idx_project_memberships_user ON project_memberships(user_id);
CREATE INDEX idx_project_memberships_project ON project_memberships(project_id);
CREATE INDEX idx_project_invitations_project ON project_invitations(project_id);
CREATE INDEX idx_project_invitations_token ON project_invitations(token_hash);
CREATE INDEX idx_boards_project ON boards(project_id);
CREATE INDEX idx_columns_board_position ON columns(board_id, position);
CREATE INDEX idx_cards_column_position ON cards(column_id, position);
CREATE INDEX idx_cards_board ON cards(board_id);
CREATE INDEX idx_cards_project ON cards(project_id);
CREATE INDEX idx_cards_state ON cards(state);
CREATE INDEX idx_card_assignees_user ON card_assignees(user_id);
CREATE INDEX idx_comments_card ON comments(card_id);
CREATE INDEX idx_comment_mentions_comment ON comment_mentions(comment_id);
CREATE INDEX idx_comment_mentions_user ON comment_mentions(user_id);
CREATE INDEX idx_activity_log_card ON activity_log(card_id);
CREATE INDEX idx_activity_log_project ON activity_log(project_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read) WHERE read = FALSE;
CREATE INDEX idx_card_images_card ON card_images(card_id);
CREATE INDEX idx_card_image_uploads_card ON card_image_uploads(card_id);
CREATE INDEX idx_card_imports_board ON card_imports(board_id);
CREATE INDEX idx_card_import_rows_import ON card_import_rows(import_id);
CREATE INDEX idx_idempotency_receipts_lookup ON idempotency_receipts(actor_id, scope_id, idempotency_key);
CREATE INDEX idx_idempotency_receipts_expires ON idempotency_receipts(expires_at);
CREATE INDEX idx_outbox_pending ON outbox(status, next_retry_at) WHERE status IN ('pending', 'processing');
