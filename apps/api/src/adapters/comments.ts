import crypto from 'node:crypto';
import type pg from 'pg';
import {
  type Comment,
  type MentionSpan,
  type PersonDisplay,
  type PostCommentInput,
  type EditCommentInput,
  postCommentInputSchema,
  editCommentInputSchema,
  parseOrThrow,
} from '@flowboard/contracts';
import { HttpError } from '../http/errors.ts';
import { getPool } from './postgres.ts';
import {
  resolveProjectRole,
  acquireWriteGrantLock,
  acquireWritableProjectContextLock,
  getEligibleMentionees,
  getHistoricalPersonDisplay,
} from './rbac.ts';
import { recordActivity } from './activity.ts';

export interface ListCardCommentsOptions {
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface ListCardCommentsResult {
  data: Comment[];
  nextCursor: string | null;
}

interface CommentCursor {
  v: 1;
  cardId: string;
  createdAt: string;
  id: string;
}

function encodeCommentCursor(cursor: CommentCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCommentCursor(value: string, cardId: string): CommentCursor {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    const parsed = JSON.parse(atob(base64)) as Partial<CommentCursor>;
    if (
      parsed.v !== 1 ||
      parsed.cardId !== cardId ||
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== 'string' ||
      parsed.id.length === 0
    ) {
      throw new Error('invalid comment cursor');
    }
    return parsed as CommentCursor;
  } catch {
    throw HttpError.conflict('STALE_CURSOR', 'Comment cursor is invalid or belongs to another card.');
  }
}

/**
 * Lists chronological comments for a card.
 * Verifies that the actor has project and board access (returns a private 404
 * for outsiders and project members without this board's grant).
 * If card is trashed or purged, normal readers cannot access it (404 NOT_FOUND).
 * Redacts deleted comment bodies and hides mentions for tombstones.
 * Includes author PersonDisplay for each comment.
 */
export async function listCardComments(
  clientOrPool: pg.Pool | pg.ClientBase,
  cardId: string,
  actorId: string,
  options?: ListCardCommentsOptions,
): Promise<ListCardCommentsResult> {
  const pool = clientOrPool ?? getPool();

  // 1. Fetch card details to identify project and state
  const cardRes = await pool.query<{
    id: string;
    project_id: string;
    workspace_id: string;
    board_id: string;
    state: string;
  }>(
    `SELECT id, project_id, workspace_id, board_id, state
     FROM cards
     WHERE id = $1`,
    [cardId],
  );

  if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  const card = cardRes.rows[0];

  // Trashed or purged cards are hidden from normal card readers (DEL-08, COM-06)
  if (card.state === 'trashed' || card.state === 'purged') {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  // 2. Verify actor has project access (outsiders get 404)
  const role = await resolveProjectRole(card.project_id, actorId, pool);
  if (!role) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  if (role !== 'owner') {
    const grantRes = await pool.query<{ board_id: string }>(
      `SELECT board_id FROM board_grants
       WHERE board_id = $1 AND project_id = $2 AND workspace_id = $3 AND user_id = $4`,
      [card.board_id, card.project_id, card.workspace_id, actorId],
    );
    if (!grantRes.rows[0]) {
      throw HttpError.notFound('Card not found.', 'NOT_FOUND');
    }
  }

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const cursor = options?.cursor ? decodeCommentCursor(options.cursor, cardId) : undefined;

  // 3. Query comments for the card ordered chronologically (created_at ASC, id ASC)
  const commentsRes = await pool.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    card_id: string;
    author_id: string;
    body: string;
    version: number;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, workspace_id, project_id, card_id, author_id, body, version, deleted_at, created_at, updated_at
     FROM comments
     WHERE card_id = $1
       AND ($2::timestamptz IS NULL OR (created_at, id) > ($2::timestamptz, $3::text))
     ORDER BY created_at ASC, id ASC
     LIMIT $4`,
    [cardId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
  );

  const rawRows = commentsRes.rows;
  const hasMore = rawRows.length > limit;
  const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow
    ? encodeCommentCursor({ v: 1, cardId, createdAt: new Date(lastRow.created_at).toISOString(), id: lastRow.id })
    : null;

  if (pageRows.length === 0) {
    return { data: [], nextCursor: null };
  }

  const commentIds = pageRows.map((r) => r.id);

  // 4. Fetch all mention spans for the retrieved comments
  const mentionsRes = await pool.query<{
    comment_id: string;
    user_id: string;
    start_offset: number;
    end_offset: number;
  }>(
    `SELECT comment_id, user_id, start_offset, end_offset
     FROM comment_mentions
     WHERE comment_id = ANY($1)
     ORDER BY start_offset ASC`,
    [commentIds],
  );

  const mentionsByCommentId = new Map<string, MentionSpan[]>();
  for (const m of mentionsRes.rows) {
    const list = mentionsByCommentId.get(m.comment_id) ?? [];
    list.push({
      userId: m.user_id,
      start: m.start_offset,
      end: m.end_offset,
    });
    mentionsByCommentId.set(m.comment_id, list);
  }

  // 5. Batch-load author PersonDisplay identities
  const authorIds = Array.from(new Set(pageRows.map((r) => r.author_id)));
  const authorsMap = new Map<string, PersonDisplay>();

  await Promise.all(
    authorIds.map(async (authorId) => {
      const display = await getHistoricalPersonDisplay(pool, card.project_id, authorId);
      if (display) {
        authorsMap.set(authorId, display);
      }
    }),
  );

  // 6. Map to Comment contracts with tombstone handling
  const comments: Comment[] = pageRows.map((row) => {
    const isDeleted = row.deleted_at !== null;
    const author = authorsMap.get(row.author_id);

    return {
      id: row.id,
      projectId: row.project_id,
      cardId: row.card_id,
      authorId: row.author_id,
      body: isDeleted ? '[Comment deleted]' : row.body,
      mentions: isDeleted ? [] : (mentionsByCommentId.get(row.id) ?? []),
      version: row.version,
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      author: author ?? undefined,
    };
  });

  return {
    data: comments,
    nextCursor,
  };
}

/**
 * Validates mention spans and project membership eligibility.
 * - Ensures spans are within UTF-16 bounds of the body.
 * - Ensures mentioned users are active readers in the project.
 */
async function validateMentions(
  client: pg.ClientBase,
  projectId: string,
  boardId: string,
  body: string,
  mentions: MentionSpan[],
): Promise<void> {
  if (mentions.length === 0) return;

  // UTF-16 code unit length check
  const bodyLen = body.length;
  for (const m of mentions) {
    if (m.start < 0 || m.end > bodyLen || m.start >= m.end) {
      throw HttpError.badRequest(
        'VALIDATION_ERROR',
        `Mention span [${m.start}, ${m.end}] is out of bounds for body length ${bodyLen}.`,
      );
    }
  }

  // A mention must reach someone who can actually open this board. Otherwise
  // the UI would suggest a recipient but the outbox would silently omit them.
  const eligible = await getEligibleMentionees(client, projectId, undefined, boardId);
  const eligibleIds = new Set(eligible.map((p) => p.id));

  for (const m of mentions) {
    if (!eligibleIds.has(m.userId)) {
      throw HttpError.badRequest(
        'VALIDATION_ERROR',
        `Mentioned user ${m.userId} cannot access this board.`,
      );
    }
  }
}

/**
 * Posts a new comment on an active card.
 * - Requires owner, manager, or member role via acquireWriteGrantLock (viewers receive 403).
 * - Verifies card is active (rejects trashed/purged cards).
 * - Validates body (1-10,000 characters) and UTF-16 non-overlapping mention spans.
 * - Enforces mention privacy: mentioned users must be active project members.
 * - Inserts comment and mention records.
 * - Generates in-app notifications for mentioned users (except actor self-mentions).
 * - Writes activity_log and outbox entries atomically.
 * - Increments board snapshot_version.
 */
export async function postComment(
  client: pg.ClientBase,
  cardId: string,
  input: { body: string; mentions?: MentionSpan[] | undefined },
  actorId: string,
): Promise<Comment> {
  const validated = parseOrThrow(postCommentInputSchema, input);

  // 1. Fetch card details with row lock
  const cardRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    board_id: string;
    state: string;
  }>(
    `SELECT id, workspace_id, project_id, board_id, state
     FROM cards
     WHERE id = $1
     FOR SHARE`,
    [cardId],
  );

  if (cardRes.rows.length === 0 || !cardRes.rows[0]) {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  const card = cardRes.rows[0];

  // Card active state check (COM-06, DEL-08)
  if (card.state === 'trashed') {
    throw HttpError.badRequest('CARD_IS_TRASHED', 'Cannot comment on a trashed card.');
  }
  if (card.state === 'purged') {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  // 2. Authorization check with write grant lock (manager/member/owner allowed; viewers 403)
  await acquireWriteGrantLock(client, card.project_id, actorId, 'member', card.board_id);
  await acquireWritableProjectContextLock(client, card.project_id, card.board_id);

  // 3. Mentions validation
  const mentions = validated.mentions ?? [];
  await validateMentions(client, card.project_id, card.board_id, validated.body, mentions);

  // 4. Fetch actor details for notification title and author display
  const actorRes = await client.query<{ display_name: string; avatar_url: string | null }>(
    `SELECT display_name, avatar_url FROM users WHERE id = $1`,
    [actorId],
  );
  const actorDisplayName = actorRes.rows[0]?.display_name ?? 'A teammate';

  // 5. Insert comment row
  const commentId = 'cmt_' + crypto.randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();

  const insertCommentRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    card_id: string;
    author_id: string;
    body: string;
    version: number;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO comments (
       id, workspace_id, project_id, card_id, author_id, body, version, deleted_at, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, 1, NULL, $7, $7)
     RETURNING id, workspace_id, project_id, card_id, author_id, body, version, deleted_at, created_at, updated_at`,
    [commentId, card.workspace_id, card.project_id, card.id, actorId, validated.body, nowIso],
  );

  const commentRow = insertCommentRes.rows[0]!;

  // 6. Insert comment mentions
  for (const m of mentions) {
    const mentionId = 'men_' + crypto.randomUUID();
    await client.query(
      `INSERT INTO comment_mentions (
         id, comment_id, user_id, start_offset, end_offset, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [mentionId, commentId, m.userId, m.start, m.end, nowIso],
    );
  }

  // 7. Insert in-app notifications for mentioned users (deduped, excluding self-mentions)
  const uniqueMentionees = Array.from(new Set(mentions.map((m) => m.userId))).filter(
    (uid) => uid !== actorId,
  );

  for (const targetUserId of uniqueMentionees) {
    const notifId = 'not_' + crypto.randomUUID();
    const notifTitle = `${actorDisplayName} mentioned you on a card`;
    const notifBody =
      validated.body.length > 200 ? validated.body.slice(0, 197) + '...' : validated.body;
    const notifLink = `/projects/${card.project_id}/boards/${card.board_id}?cardId=${card.id}`;

    await client.query(
      `INSERT INTO notifications (
         id, workspace_id, project_id, user_id, type, title, body, link, read, created_at, card_id
       ) VALUES ($1, $2, $3, $4, 'mention', $5, $6, $7, FALSE, $8, $9)`,
      [notifId, card.workspace_id, card.project_id, targetUserId, notifTitle, notifBody, notifLink, nowIso, card.id],
    );
  }

  // 8. Atomic activity_log commit
  await recordActivity(client, {
    workspaceId: card.workspace_id,
    projectId: card.project_id,
    boardId: card.board_id,
    cardId: card.id,
    actorId,
    action: 'comment_created',
    safeChanges: { commentId, mentionsCount: mentions.length },
    createdAt: nowIso,
  });

  // 9. Atomic outbox event commit
  const outboxId = 'out_' + crypto.randomUUID();
  await client.query(
    `INSERT INTO outbox (
       id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at
     ) VALUES ($1, $2, $3, 'comment.created', $4, 'pending', 0, $5, $5)`,
    [
      outboxId,
      card.workspace_id,
      card.project_id,
      JSON.stringify({
        commentId,
        cardId: card.id,
        authorId: actorId,
        mentions: uniqueMentionees,
      }),
      nowIso,
    ],
  );

  // 10. Increment board snapshot_version
  await client.query(
    `UPDATE boards
     SET snapshot_version = snapshot_version + 1, updated_at = $1
     WHERE id = $2`,
    [nowIso, card.board_id],
  );

  // 11. Build author display
  const authorDisplay = await getHistoricalPersonDisplay(client, card.project_id, actorId);

  return {
    id: commentRow.id,
    projectId: commentRow.project_id,
    cardId: commentRow.card_id,
    authorId: commentRow.author_id,
    body: commentRow.body,
    mentions,
    version: commentRow.version,
    deletedAt: null,
    createdAt: new Date(commentRow.created_at).toISOString(),
    updatedAt: new Date(commentRow.updated_at).toISOString(),
    author: authorDisplay ?? undefined,
  };
}

/**
 * Edits an existing comment.
 * - Author only: non-author members or managers receive 403 FORBIDDEN.
 * - OCC check: expectedVersion must match current version (409 STALE_VERSION on mismatch).
 * - Re-validates mentions and updates comment_mentions table.
 * - Does NOT send new mention notifications on edit.
 * - Increments comment version and board snapshot_version.
 */
export async function editComment(
  client: pg.ClientBase,
  commentId: string,
  input: EditCommentInput,
  actorId: string,
): Promise<Comment> {
  const validated = parseOrThrow(editCommentInputSchema, input);

  // 1. Fetch comment and card details with row lock
  const commentRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    card_id: string;
    author_id: string;
    body: string;
    version: number;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
    card_state: string;
    board_id: string;
  }>(
    `SELECT c.id, c.workspace_id, c.project_id, c.card_id, c.author_id, c.body, c.version,
            c.deleted_at, c.created_at, c.updated_at, cd.state AS card_state, cd.board_id
     FROM comments c
     JOIN cards cd ON c.card_id = cd.id
     WHERE c.id = $1
     FOR UPDATE`,
    [commentId],
  );

  if (commentRes.rows.length === 0 || !commentRes.rows[0]) {
    throw HttpError.notFound('Comment not found.', 'NOT_FOUND');
  }

  const comment = commentRes.rows[0];

  // Deleted comments cannot be edited
  if (comment.deleted_at !== null) {
    throw HttpError.badRequest('COMMENT_DELETED', 'Cannot edit a deleted comment.');
  }

  // Card active state check (COM-06, DEL-08)
  if (comment.card_state === 'trashed') {
    throw HttpError.badRequest('CARD_IS_TRASHED', 'Cannot edit comment on a trashed card.');
  }
  if (comment.card_state === 'purged') {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  // 2. Author only check (COM-04: moderators can delete, not edit someone else's comment)
  if (actorId !== comment.author_id) {
    throw HttpError.forbidden('Only the author can edit this comment.', 'FORBIDDEN');
  }

  // Verify author still has write access to the project
  await acquireWriteGrantLock(client, comment.project_id, actorId, 'member', comment.board_id);
  await acquireWritableProjectContextLock(client, comment.project_id, comment.board_id);

  // 3. OCC check
  if (comment.version !== validated.expectedVersion) {
    throw HttpError.conflict('STALE_VERSION', 'Comment has been modified concurrently.');
  }

  // 4. Mentions re-validation if provided
  const mentions = validated.mentions ?? [];
  await validateMentions(client, comment.project_id, comment.board_id, validated.body, mentions);

  const now = new Date();
  const nowIso = now.toISOString();

  // 5. Update comment body and version
  const updateRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    card_id: string;
    author_id: string;
    body: string;
    version: number;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `UPDATE comments
     SET body = $1, version = version + 1, updated_at = $2
     WHERE id = $3
     RETURNING id, workspace_id, project_id, card_id, author_id, body, version, deleted_at, created_at, updated_at`,
    [validated.body, nowIso, commentId],
  );

  const updatedRow = updateRes.rows[0]!;

  // 6. Replace comment_mentions
  await client.query(`DELETE FROM comment_mentions WHERE comment_id = $1`, [commentId]);

  for (const m of mentions) {
    const mentionId = 'men_' + crypto.randomUUID();
    await client.query(
      `INSERT INTO comment_mentions (
         id, comment_id, user_id, start_offset, end_offset, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [mentionId, commentId, m.userId, m.start, m.end, nowIso],
    );
  }

  // 7. Activity log fact
  await recordActivity(client, {
    workspaceId: comment.workspace_id,
    projectId: comment.project_id,
    boardId: comment.board_id,
    cardId: comment.card_id,
    actorId,
    action: 'comment_updated',
    safeChanges: { commentId, version: updatedRow.version },
    createdAt: nowIso,
  });

  // 8. Increment board snapshot_version
  await client.query(
    `UPDATE boards
     SET snapshot_version = snapshot_version + 1, updated_at = $1
     WHERE id = $2`,
    [nowIso, comment.board_id],
  );

  const authorDisplay = await getHistoricalPersonDisplay(client, comment.project_id, actorId);

  return {
    id: updatedRow.id,
    projectId: updatedRow.project_id,
    cardId: updatedRow.card_id,
    authorId: updatedRow.author_id,
    body: updatedRow.body,
    mentions,
    version: updatedRow.version,
    deletedAt: null,
    createdAt: new Date(updatedRow.created_at).toISOString(),
    updatedAt: new Date(updatedRow.updated_at).toISOString(),
    author: authorDisplay ?? undefined,
  };
}

/**
 * Deletes a comment using the tombstone pattern.
 * - Author can delete their own comment.
 * - Workspace owner and project manager can delete any comment in the project (moderation).
 * - Non-author members/viewers receive 403 FORBIDDEN.
 * - OCC check: expectedVersion must match current version (409 STALE_VERSION on mismatch).
 * - Sets deleted_at = NOW() and increments version.
 */
export async function deleteComment(
  client: pg.ClientBase,
  commentId: string,
  expectedVersion: number,
  actorId: string,
): Promise<{ success: true; id: string; version: number }> {
  // 1. Fetch comment with row lock
  const commentRes = await client.query<{
    id: string;
    workspace_id: string;
    project_id: string;
    card_id: string;
    author_id: string;
    version: number;
    deleted_at: Date | null;
    board_id: string;
    card_state: string;
  }>(
    `SELECT c.id, c.workspace_id, c.project_id, c.card_id, c.author_id, c.version,
            c.deleted_at, cd.board_id, cd.state AS card_state
     FROM comments c
     JOIN cards cd ON c.card_id = cd.id
     WHERE c.id = $1
     FOR UPDATE`,
    [commentId],
  );

  if (commentRes.rows.length === 0 || !commentRes.rows[0]) {
    throw HttpError.notFound('Comment not found.', 'NOT_FOUND');
  }

  const comment = commentRes.rows[0];

  if (comment.card_state === 'trashed') {
    throw HttpError.badRequest('CARD_IS_TRASHED', 'Cannot delete a comment on a trashed card.');
  }
  if (comment.card_state === 'purged') {
    throw HttpError.notFound('Card not found.', 'NOT_FOUND');
  }

  // Already deleted comment check
  if (comment.deleted_at !== null) {
    throw HttpError.notFound('Comment not found or already deleted.', 'NOT_FOUND');
  }

  // 2. Authorization check (COM-05: Author OR workspace owner / project manager)
  if (actorId === comment.author_id) {
    // Author deleting own comment: verify they are still in the project
    await acquireWriteGrantLock(client, comment.project_id, actorId, 'member', comment.board_id);
    await acquireWritableProjectContextLock(client, comment.project_id, comment.board_id);
  } else {
    // Moderator deleting comment: requires manager or owner role
    await acquireWriteGrantLock(client, comment.project_id, actorId, 'manager', comment.board_id);
    await acquireWritableProjectContextLock(client, comment.project_id, comment.board_id);
  }

  // 3. OCC check
  if (comment.version !== expectedVersion) {
    throw HttpError.conflict('STALE_VERSION', 'Comment has been modified concurrently.');
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // 4. Tombstone update: mark deleted_at = NOW(), redact body to empty string, and increment version
  const updateRes = await client.query<{ version: number }>(
    `UPDATE comments
     SET deleted_at = $1, body = '', version = version + 1, updated_at = $1
     WHERE id = $2
     RETURNING version`,
    [nowIso, commentId],
  );

  // Redact any mention spans associated with this comment
  await client.query(`DELETE FROM comment_mentions WHERE comment_id = $1`, [commentId]);

  const newVersion = updateRes.rows[0]!.version;

  // 5. Activity log fact
  await recordActivity(client, {
    workspaceId: comment.workspace_id,
    projectId: comment.project_id,
    boardId: comment.board_id,
    cardId: comment.card_id,
    actorId,
    action: 'comment_deleted',
    safeChanges: { commentId, deletedBy: actorId },
    createdAt: nowIso,
  });

  // 6. Increment board snapshot_version
  await client.query(
    `UPDATE boards
     SET snapshot_version = snapshot_version + 1, updated_at = $1
     WHERE id = $2`,
    [nowIso, comment.board_id],
  );

  return {
    success: true,
    id: commentId,
    version: newVersion,
  };
}
