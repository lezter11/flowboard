-- Flowboard PostgreSQL Schema Migration 0003
-- Strengthen ancestry, owner foreign keys, and relational hierarchy constraints.

-- 1. Workspace owner foreign key constraint
-- Ensures a workspace cannot reference a non-existent owner, and deleting an active owner is blocked.
ALTER TABLE workspaces
  ADD CONSTRAINT fk_workspaces_owner
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT;

-- 2. Projects composite unique constraint
-- Enables child entities with (project_id, workspace_id) to enforce strict matching parentage.
ALTER TABLE projects
  ADD CONSTRAINT uq_projects_id_workspace
  UNIQUE (id, workspace_id);

-- 3. Project memberships ancestry constraint
ALTER TABLE project_memberships
  ADD CONSTRAINT fk_project_memberships_project_workspace
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE RESTRICT;

-- 4. Project invitations ancestry constraint
ALTER TABLE project_invitations
  ADD CONSTRAINT fk_project_invitations_project_workspace
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE RESTRICT;

-- 5. Boards ancestry constraint and composite unique constraint for child entities
ALTER TABLE boards
  ADD CONSTRAINT fk_boards_project_workspace
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE boards
  ADD CONSTRAINT uq_boards_id_project_workspace
  UNIQUE (id, project_id, workspace_id);

-- 6. Columns ancestry constraint and composite unique constraint for child entities
ALTER TABLE columns
  ADD CONSTRAINT fk_columns_board_project_workspace
  FOREIGN KEY (board_id, project_id, workspace_id) REFERENCES boards(id, project_id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE columns
  ADD CONSTRAINT uq_columns_id_board
  UNIQUE (id, board_id);

-- 7. Cards ancestry constraints linking board/project/workspace and column/board
ALTER TABLE cards
  ADD CONSTRAINT fk_cards_board_project_workspace
  FOREIGN KEY (board_id, project_id, workspace_id) REFERENCES boards(id, project_id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE cards
  ADD CONSTRAINT fk_cards_column_board
  FOREIGN KEY (column_id, board_id) REFERENCES columns(id, board_id) ON DELETE RESTRICT;

ALTER TABLE cards
  ADD CONSTRAINT uq_cards_id_project_workspace
  UNIQUE (id, project_id, workspace_id);

-- 8. Card assignees ancestry constraint
ALTER TABLE card_assignees
  ADD CONSTRAINT fk_card_assignees_card_project_workspace
  FOREIGN KEY (card_id, project_id, workspace_id) REFERENCES cards(id, project_id, workspace_id) ON DELETE CASCADE;

-- 9. Comments ancestry constraint
ALTER TABLE comments
  ADD CONSTRAINT fk_comments_card_project_workspace
  FOREIGN KEY (card_id, project_id, workspace_id) REFERENCES cards(id, project_id, workspace_id) ON DELETE CASCADE;

-- 10. Card images ancestry constraint
ALTER TABLE card_images
  ADD CONSTRAINT fk_card_images_card_project_workspace
  FOREIGN KEY (card_id, project_id, workspace_id) REFERENCES cards(id, project_id, workspace_id) ON DELETE CASCADE;

-- 11. Card image uploads ancestry constraint
ALTER TABLE card_image_uploads
  ADD CONSTRAINT fk_card_image_uploads_card_project_workspace
  FOREIGN KEY (card_id, project_id, workspace_id) REFERENCES cards(id, project_id, workspace_id) ON DELETE CASCADE;

-- 12. Card imports ancestry constraints
ALTER TABLE card_imports
  ADD CONSTRAINT fk_card_imports_board_project_workspace
  FOREIGN KEY (board_id, project_id, workspace_id) REFERENCES boards(id, project_id, workspace_id) ON DELETE RESTRICT;

ALTER TABLE card_imports
  ADD CONSTRAINT fk_card_imports_column_board
  FOREIGN KEY (default_column_id, board_id) REFERENCES columns(id, board_id) ON DELETE RESTRICT;

-- 13. Card import duplicates ancestry constraint
ALTER TABLE card_import_duplicates
  ADD CONSTRAINT fk_card_import_duplicates_board_project_workspace
  FOREIGN KEY (board_id, project_id, workspace_id) REFERENCES boards(id, project_id, workspace_id) ON DELETE RESTRICT;

-- 14. Activity log ancestry constraint
ALTER TABLE activity_log
  ADD CONSTRAINT fk_activity_log_project_workspace
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE RESTRICT;

-- 15. Notifications ancestry constraint
ALTER TABLE notifications
  ADD CONSTRAINT fk_notifications_project_workspace
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE RESTRICT;

-- 16. Outbox ancestry constraint
ALTER TABLE outbox
  ADD CONSTRAINT fk_outbox_project_workspace
  FOREIGN KEY (project_id, workspace_id) REFERENCES projects(id, workspace_id) ON DELETE RESTRICT;
