-- Initial D1/SQLite design. Apply through Wrangler in the implementation phase.
-- Authorization, last-owner protection, real calendar validation and CAS commands
-- require the API; these constraints do not replace those checks.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY (provider, subject)
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK(role IN ('owner','admin','member','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, user_id)
);
CREATE UNIQUE INDEX one_active_owner ON memberships(workspace_id)
  WHERE role = 'owner' AND status = 'active';
CREATE INDEX memberships_user ON memberships(user_id, status);
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  email_normalized TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('member','viewer')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX invitations_workspace ON invitations(workspace_id);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, id)
);
CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  structure_version INTEGER NOT NULL DEFAULT 1 CHECK(structure_version > 0),
  snapshot_version INTEGER NOT NULL DEFAULT 1 CHECK(snapshot_version > 0),
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, id),
  FOREIGN KEY(workspace_id, project_id) REFERENCES projects(workspace_id, id)
);
CREATE INDEX boards_project ON boards(workspace_id, project_id);
CREATE TABLE board_columns (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
  category TEXT NOT NULL CHECK(category IN ('todo','active','done')),
  color TEXT,
  position INTEGER NOT NULL CHECK(position >= 0),
  UNIQUE(workspace_id, board_id, id),
  FOREIGN KEY(workspace_id, board_id) REFERENCES boards(workspace_id, id)
);
CREATE INDEX columns_order ON board_columns(workspace_id, board_id, position, id);
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description) <= 20000),
  priority TEXT NOT NULL DEFAULT 'none' CHECK(priority IN ('none','low','medium','high','urgent')),
  due_date TEXT CHECK(due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  position INTEGER NOT NULL CHECK(position >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  creator_id TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, id),
  UNIQUE(workspace_id, board_id, id),
  FOREIGN KEY(workspace_id, board_id, column_id) REFERENCES board_columns(workspace_id, board_id, id),
  FOREIGN KEY(workspace_id, creator_id) REFERENCES memberships(workspace_id, user_id)
);
CREATE INDEX cards_order ON cards(workspace_id, board_id, column_id, archived_at, position, id);
CREATE INDEX cards_due ON cards(workspace_id, due_date) WHERE archived_at IS NULL;
CREATE TABLE card_assignees (
  workspace_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY(card_id, user_id),
  FOREIGN KEY(workspace_id, card_id) REFERENCES cards(workspace_id, id),
  FOREIGN KEY(workspace_id, user_id) REFERENCES memberships(workspace_id, user_id)
);
CREATE INDEX assignees_user ON card_assignees(workspace_id, user_id, card_id);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 10000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, id),
  FOREIGN KEY(workspace_id, card_id) REFERENCES cards(workspace_id, id),
  FOREIGN KEY(workspace_id, author_id) REFERENCES memberships(workspace_id, user_id)
);
CREATE INDEX comments_card ON comments(workspace_id, card_id, created_at, id);
CREATE TABLE comment_mentions (
  workspace_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  start_offset INTEGER NOT NULL CHECK(start_offset >= 0),
  end_offset INTEGER NOT NULL CHECK(end_offset > start_offset),
  PRIMARY KEY(comment_id, start_offset),
  FOREIGN KEY(workspace_id, comment_id) REFERENCES comments(workspace_id, id),
  FOREIGN KEY(workspace_id, user_id) REFERENCES memberships(workspace_id, user_id)
);

CREATE TABLE activity_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  card_id TEXT,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL CHECK(json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, id),
  FOREIGN KEY(workspace_id, board_id) REFERENCES boards(workspace_id, id),
  FOREIGN KEY(workspace_id, board_id, card_id) REFERENCES cards(workspace_id, board_id, id),
  FOREIGN KEY(workspace_id, actor_id) REFERENCES memberships(workspace_id, user_id)
);
CREATE INDEX activity_board ON activity_events(workspace_id, board_id, created_at, id);
CREATE INDEX activity_card ON activity_events(workspace_id, card_id, created_at, id);
CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  available_at TEXT NOT NULL,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, event_type),
  FOREIGN KEY(workspace_id, event_id) REFERENCES activity_events(workspace_id, id)
);
CREATE INDEX outbox_pending ON outbox(status, available_at, lease_until);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, recipient_id),
  FOREIGN KEY(workspace_id, event_id) REFERENCES activity_events(workspace_id, id),
  FOREIGN KEY(workspace_id, recipient_id) REFERENCES memberships(workspace_id, user_id)
);
CREATE INDEX notifications_inbox ON notifications(recipient_id, created_at, id);
CREATE TABLE idempotency_receipts (
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL CHECK(response_status BETWEEN 200 AND 299),
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, actor_id, request_key),
  FOREIGN KEY(workspace_id, actor_id) REFERENCES memberships(workspace_id, user_id)
);
CREATE INDEX receipts_expiry ON idempotency_receipts(expires_at);

-- Actor-global operations can be retried before the client knows a workspace ID.
CREATE TABLE actor_operation_receipts (
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL CHECK(response_status BETWEEN 200 AND 299),
  response_json TEXT NOT NULL CHECK(json_valid(response_json)),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(actor_id, request_key)
);
CREATE INDEX actor_receipts_expiry ON actor_operation_receipts(expires_at);

-- Temporary per-request CAS gate inserted and removed within one atomic batch.
-- INSERT immediately after guarded UPDATE, binding changes() as affected_rows.
-- A zero-row UPDATE then fails this CHECK and forces batch rollback.
CREATE TABLE mutation_guards (
  token TEXT PRIMARY KEY,
  affected_rows INTEGER NOT NULL CHECK(affected_rows = 1)
);
