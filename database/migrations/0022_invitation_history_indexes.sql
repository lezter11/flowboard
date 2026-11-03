-- Bounded invitation history and latest delivery lookup. No invitation token/content is indexed.
CREATE INDEX IF NOT EXISTS idx_project_invitations_history
  ON project_invitations (project_id, created_at DESC, id DESC);

-- Terminal delivery receipts retain only the opaque invitationId association and optional provider id.
-- Legacy settled rows without an association intentionally remain unknown to the history API.
CREATE INDEX IF NOT EXISTS idx_outbox_invitation_delivery
  ON outbox (project_id, (payload->>'invitationId'), created_at DESC, id DESC)
  WHERE event_type = 'invitation.created';
