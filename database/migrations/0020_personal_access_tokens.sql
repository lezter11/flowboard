-- 0020 (PAT-01): Personal access tokens with scoped authorization.
-- Additive and idempotent: a second run creates nothing new.
--
-- 1. personal_access_tokens table:
--    - id: prefixed uuid (pat_...)
--    - user_id: references users(id) ON DELETE CASCADE
--    - name: friendly label (e.g. "Claude MCP Token")
--    - token_hash: sha256(raw_token) for secure lookup, unique
--    - token_prefix: visible prefix (e.g. "flw_pat_...") for UI listing/identification
--    - scopes: text array of authorized permissions (e.g. {'cards:create', 'boards:read', 'projects:read'})
--    - project_id: optional reference to projects(id) ON DELETE CASCADE (resource-scoped token)
--    - expires_at: optional timestamp when token expires
--    - revoked_at: optional timestamp when token is invalidated
--    - last_used_at: timestamp when token was last verified
--    - created_at, updated_at: standard audit timestamps

CREATE TABLE IF NOT EXISTS personal_access_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_personal_access_tokens_hash 
  ON personal_access_tokens(token_hash) 
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_personal_access_tokens_user 
  ON personal_access_tokens(user_id);
