-- Additive: a plain-text brief on each project, and up to 10 https links per project.
-- No backfill: existing projects have a NULL brief and no links.
-- Idempotent: IF NOT EXISTS everywhere, so a second run changes nothing.
-- The API enforces the length, count and https rules (packages/contracts). The CHECKs below are a
-- second line of defence so a bad row cannot be written by another path.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS brief TEXT;

CREATE TABLE IF NOT EXISTS project_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  url TEXT NOT NULL CHECK (url ~* '^https://' AND char_length(url) <= 2000),
  position INTEGER NOT NULL CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (project_id, position)
);
