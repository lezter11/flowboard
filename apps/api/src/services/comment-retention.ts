import type pg from 'pg';

/** A closed allowlist: retained jobs carry source identity, never body/title/raw copies. */
const safeCommentPayload = `COALESCE((
  SELECT jsonb_build_object('commentId',c.id,'cardId',c.card_id,'authorId',c.author_id,
    'mentions',CASE WHEN c.deleted_at IS NOT NULL THEN '[]'::jsonb ELSE COALESCE((
      SELECT jsonb_agg(u.id ORDER BY u.id) FROM users u WHERE u.id IN (
        SELECT value FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(o.payload->'mentions')='array' THEN o.payload->'mentions' ELSE '[]'::jsonb END))
        AND u.id<>c.author_id),'[]'::jsonb) END,'redacted',c.deleted_at IS NOT NULL)
  FROM comments c WHERE c.id=o.payload->>'commentId' AND c.card_id=o.payload->>'cardId'
    AND c.project_id=o.project_id AND c.workspace_id=o.workspace_id
),'{}'::jsonb)`;

/** The consumer already holds its outbox row lock. Sanitize before ANY retry/failure path. */
export async function sanitizeCommentOutbox(client: pg.ClientBase, outboxId: string): Promise<Record<string, unknown>> {
  // Consumer order is outbox → source card → source comment, matching card-before-comment
  // resource writes. Editors skip busy jobs. Read spans/version in a new statement after
  // the source lock, so an edit that won while we waited cannot leave an old private payload alive.
  await client.query(`SELECT cd.id FROM cards cd JOIN comments c ON c.card_id=cd.id
    JOIN outbox o ON c.id=o.payload->>'commentId' AND c.card_id=o.payload->>'cardId'
      AND c.project_id=o.project_id AND c.workspace_id=o.workspace_id
    WHERE o.id=$1 AND o.event_type='comment.created' FOR SHARE OF cd`, [outboxId]);
  await client.query(`SELECT c.id FROM comments c JOIN outbox o
    ON c.id=o.payload->>'commentId' AND c.card_id=o.payload->>'cardId'
      AND c.project_id=o.project_id AND c.workspace_id=o.workspace_id
    WHERE o.id=$1 AND o.event_type='comment.created' FOR SHARE OF c`, [outboxId]);
  const result = await client.query<{
    payload: Record<string, unknown>;
  }>(`UPDATE outbox o SET payload=${safeCommentPayload} WHERE o.id=$1 AND o.event_type='comment.created' RETURNING payload`, [outboxId]);
  return result.rows[0]?.payload ?? {};
}

/** Call within comment tombstone transaction after current authority and version checks.
 * A consumer locks outbox before source-comment rows. Skip busy jobs here instead of waiting
 * in the opposite order; that consumer sanitizes its claim before validation/retry/settlement.
 */
export async function redactCommentCopies(client: pg.ClientBase, source: {
  commentId: string;
  cardId: string;
  projectId: string;
  workspaceId: string;
}): Promise<void> {
  await client.query(`UPDATE notifications SET title='Comment deleted',body='[Comment deleted]'
    WHERE type='mention' AND project_id=$2 AND workspace_id=$3
      AND (comment_id=$1 OR (comment_id IS NULL AND card_id=$4))`, [source.commentId, source.projectId, source.workspaceId, source.cardId]);
  await client.query(`UPDATE outbox o SET payload=${safeCommentPayload} WHERE o.id IN (
    SELECT id FROM outbox WHERE event_type='comment.created' AND project_id=$2 AND workspace_id=$3
      AND payload->>'commentId'=$1 AND payload->>'cardId'=$4 FOR UPDATE SKIP LOCKED)`, [source.commentId, source.projectId, source.workspaceId, source.cardId]);
}

/** Editing does not notify again. Replace old exact-source previews with a generic fact.
 * Legacy rows without comment_id cannot be attributed to this edit and are not rewritten.
 * Busy outbox jobs are sanitized by their consumer after it acquires the source lock.
 */
export async function redactEditedCommentCopies(client: pg.ClientBase, source: {
  commentId: string; cardId: string; projectId: string; workspaceId: string;
}): Promise<void> {
  await client.query(`UPDATE notifications SET title='Comment edited',body='[Comment edited]'
    WHERE type='mention' AND comment_id=$1 AND card_id=$4 AND project_id=$2 AND workspace_id=$3`,
    [source.commentId,source.projectId,source.workspaceId,source.cardId]);
  await client.query(`UPDATE outbox o SET payload=${safeCommentPayload} WHERE o.id IN (
    SELECT id FROM outbox WHERE event_type='comment.created' AND project_id=$2 AND workspace_id=$3
      AND payload->>'commentId'=$1 AND payload->>'cardId'=$4 FOR UPDATE SKIP LOCKED)`,
    [source.commentId,source.projectId,source.workspaceId,source.cardId]);
}
