-- Additive: a project link must belong to the same workspace as its project (FB-AUD-07).
-- Before this, the foreign keys on project_links.workspace_id and project_links.project_id were
-- independent, so one row could name workspace A with a project from workspace B. The composite
-- key below reuses the unique (id, workspace_id) key that projects already has (migration 0003).
-- No backfill: a row that already pairs a link with another workspace's project would stop the
-- constraint from being added. Such a row cannot come from the API, and an operator must fix it first.
-- Idempotent: the constraint is added inside a DO block that ignores "already exists", so a second
-- run changes nothing.
DO $$
BEGIN
  ALTER TABLE project_links ADD CONSTRAINT project_links_project_workspace_fk
    FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE RESTRICT;
EXCEPTION
  -- duplicate_object: the named foreign key already exists on a re-run.
  WHEN duplicate_object OR duplicate_table THEN NULL;
END
$$;
