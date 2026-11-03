-- Durable comment-recipient identity. Do not guess a source for legacy notifications.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS comment_id TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='comments'::regclass AND conname='uq_comments_source_context') THEN
    ALTER TABLE comments ADD CONSTRAINT uq_comments_source_context UNIQUE(id,card_id,project_id,workspace_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notifications'::regclass AND conname='notification_comment_has_card') THEN
    ALTER TABLE notifications ADD CONSTRAINT notification_comment_has_card CHECK(comment_id IS NULL OR card_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notifications'::regclass AND conname='fk_notification_comment_context') THEN
    ALTER TABLE notifications ADD CONSTRAINT fk_notification_comment_context
      FOREIGN KEY(comment_id,card_id,project_id,workspace_id)
      REFERENCES comments(id,card_id,project_id,workspace_id) ON DELETE SET NULL (comment_id);
  END IF;
END $$;

-- Synchronous notifications used the exact comment creation instant. Associate only one
-- unambiguous matching comment/recipient; deleted spans or uncertain times stay unknown.
WITH candidates AS (
  SELECT n.id,MIN(c.id) AS comment_id
  FROM notifications n JOIN comments c
    ON c.card_id=n.card_id AND c.project_id=n.project_id AND c.workspace_id=n.workspace_id
    AND c.created_at=n.created_at
  JOIN comment_mentions m ON m.comment_id=c.id AND m.user_id=n.user_id
  WHERE n.type='mention' AND n.comment_id IS NULL
  GROUP BY n.id HAVING COUNT(DISTINCT c.id)=1
), unique_recipient AS (
  SELECT n.id,c.comment_id,ROW_NUMBER() OVER (PARTITION BY c.comment_id,n.user_id ORDER BY n.created_at,n.id) AS rank
  FROM candidates c JOIN notifications n ON n.id=c.id
  WHERE NOT EXISTS(SELECT 1 FROM notifications other WHERE other.comment_id=c.comment_id AND other.user_id=n.user_id AND other.type='mention')
)
UPDATE notifications n SET comment_id=c.comment_id FROM unique_recipient c WHERE n.id=c.id AND c.rank=1;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_comment_recipient
  ON notifications(comment_id,user_id) WHERE type='mention' AND comment_id IS NOT NULL;

-- Unknown provenance cannot justify retaining a possible deleted body. Keep the notification
-- fact/read state/recipient/card link, but replace the display copy rather than invent an ID.
UPDATE notifications n SET title='Mention notification',body='Comment content is unavailable.'
WHERE n.type='mention' AND (n.comment_id IS NULL OR EXISTS(
  SELECT 1 FROM comments c WHERE c.id=n.comment_id AND c.deleted_at IS NOT NULL));

-- Never retain arbitrary content fields in legacy comment jobs. Keep only validated source
-- IDs and existing-user recipient IDs; delivery rechecks current project/board access.
UPDATE outbox o SET payload=COALESCE((
  SELECT jsonb_build_object('commentId',c.id,'cardId',c.card_id,'authorId',c.author_id,
    'mentions',CASE WHEN c.deleted_at IS NOT NULL THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(u.id ORDER BY u.id) FROM users u WHERE u.id IN (
        SELECT value FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.payload->'mentions')='array' THEN o.payload->'mentions' ELSE '[]'::jsonb END))
        AND u.id<>c.author_id),'[]'::jsonb) END,'redacted',c.deleted_at IS NOT NULL)
  FROM comments c WHERE c.id=o.payload->>'commentId' AND c.card_id=o.payload->>'cardId'
    AND c.project_id=o.project_id AND c.workspace_id=o.workspace_id
),'{}'::jsonb) WHERE o.event_type='comment.created';
