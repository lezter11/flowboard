'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { Comment, CommentListResponse, PersonDisplay } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { commentPermissions, commentSessions, editDraftFromComment } from '@/lib/comment-state';
import { useCursorFeed } from '@/lib/cursor-feed';
import { finalizeMentions, segments } from '@/lib/mentions';
import { relativeTime } from '@/lib/dates';
import { formatPersonName } from '@/lib/person-name';
import { namesFor } from '@/lib/assignees';
import { can, type Role } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { usePollKeys } from '@/components/polling';
import { Avatar } from '@/components/ui/avatar';
import { DialogLayer } from '@/components/ui/dialog-layer';
import { ErrorNote } from '@/components/ui/error-note';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toasts';
import { CommentComposer } from './comment-composer';

export function CardComments({ cardId, projectId, boardId, people, role, onChanged }: { cardId: string; projectId: string; boardId: string; people: Map<string, PersonDisplay>; role: Role; onChanged: () => void }) {
  const { state } = useSession();
  const actorId = state.status === 'ready' ? state.session.actor.id : '';
  const writable = !!actorId && can(role, 'edit');
  const session = useMemo(() => commentSessions.forCard(actorId, cardId, { projectId, boardId }), [actorId, cardId, projectId, boardId]);
  const drafts = useSyncExternalStore(session.subscribe, session.get, session.get);
  const [deleteVisible, setDeleteVisible] = useState(!!drafts.remove);
  const queryClient = useQueryClient(); const toast = useToast();
  const queryKey = useMemo(() => ['comments', cardId, actorId] as const, [cardId, actorId]);
  const mentionPeople = useQuery({
    queryKey: ['project-people', projectId, 'mention', cardId, actorId],
    queryFn: async () => (await api.listProjectPeople(projectId, 'mention', { cardId })).data,
    enabled: !!actorId, staleTime: 60_000, retry: false,
  });
  const names = useMemo(() => namesFor(people, mentionPeople.data), [people, mentionPeople.data]);
  const feed = useCursorFeed<Comment>(queryKey, (cursor, signal) => api.listCardComments(cardId, { cursor, signal }));
  useEffect(() => { session.reconcile(feed.items); }, [session, feed.data]);
  usePollKeys([queryKey]);
  const createInput = useRef<HTMLDivElement>(null);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['comments', cardId] }); void queryClient.invalidateQueries({ queryKey: ['card-activity', cardId] }); onChanged(); };
  const post = useMutation({
    mutationFn: () => session.post.run(finalizeMentions(drafts.create.body, drafts.create.mentions), (input, key) => api.postCardComment(cardId, input, key)),
    onSuccess: () => { session.update({ create: { body: '', mentions: [] } }); toast('Comment posted', { icon: 'check' }); refresh(); requestAnimationFrame(() => createInput.current?.querySelector('textarea')?.focus()); },
  });
  const edit = useMutation({
    mutationFn: () => {
      const draft = session.get().edit;
      if (!draft) return session.edit.retry((original, key) => api.editComment(original.id, original.input, key));
      return session.edit.run({ id: draft.commentId, input: { ...finalizeMentions(draft.body, draft.mentions), expectedVersion: draft.expectedVersion } }, (original, key) => api.editComment(original.id, original.input, key));
    },
    onSuccess: () => { session.update({ edit: null }); toast('Comment saved', { icon: 'check' }); refresh(); requestAnimationFrame(() => createInput.current?.querySelector('textarea')?.focus()); },
    onError: () => { void feed.refetch(); },
  });
  const remove = useMutation({
    mutationFn: () => {
      const target = session.get().remove;
      if (!target) return Promise.reject(new Error('Choose a comment to delete.'));
      return session.remove.run({ id: target.id, input: { expectedVersion: target.version } }, (original, key) => api.deleteComment(original.id, original.input, key));
    },
    onSuccess: (response) => {
      const id = session.get().remove?.id;
      queryClient.setQueryData<InfiniteData<CommentListResponse>>(queryKey, (old) => old ? { ...old, pages: old.pages.map((page) => ({ ...page, data: page.data.map((comment) => comment.id === id ? { ...comment, body: '', mentions: [], deletedAt: new Date().toISOString(), version: response.data.version } : comment) })) } : old);
      session.update({ remove: null }); toast('Comment deleted', { icon: 'trash' }); refresh();
    },
    onError: () => { void feed.refetch(); },
  });
  const unavailable = feed.error && typeof feed.error === 'object' && 'status' in feed.error && [401, 403, 404].includes(Number(feed.error.status));
  const comments = unavailable ? [] : feed.items;
  const targetEdit = drafts.edit && comments.find((comment) => comment.id === drafts.edit?.commentId);
  const targetRemove = drafts.remove && comments.find((comment) => comment.id === drafts.remove?.id);
  const editAllowed = targetEdit && commentPermissions(role, actorId, targetEdit).edit;
  const removeAllowed = targetRemove && commentPermissions(role, actorId, targetRemove).remove;
  const staleCursor = !!feed.error && typeof feed.error === 'object' && 'code' in feed.error && feed.error.code === 'STALE_CURSOR';
  const reload = () => { void queryClient.resetQueries({ queryKey, exact: true }); };

  return (
    <>
      <div className="comment-list" aria-busy={feed.isFetching}>
        {feed.isPending && <p className="comment-empty" role="status">Loading comments…</p>}
        {feed.isError && <ErrorNote text={staleCursor ? 'The comment list changed. Reload this list; your drafts are kept.' : undefined} error={feed.error} onRetry={() => { if (feed.isFetchNextPageError && !staleCursor) void feed.fetchNextPage(); else if (!staleCursor) void feed.refetch(); }} />}
        {staleCursor && <p className="hint">The list changed. Your draft is kept. <button className="btn sm" type="button" onClick={reload}>Reload comments</button></p>}
        {feed.isSuccess && !comments.length && <p className="comment-empty">No comments yet.{writable ? ' Start the discussion below.' : ''}</p>}
        {comments.map((comment) => {
          const author = formatPersonName(comment.author ?? people.get(comment.authorId), 'Former member');
          const permissions = commentPermissions(role, actorId, comment);
          return <article key={comment.id} className="comment" aria-label={`Comment by ${author}`}>
            <Avatar id={comment.authorId} name={author} avatarUrl={(comment.author??people.get(comment.authorId))?.avatarUrl} />
            <div className="comment-main">
              <div className="comment-head"><span className="comment-author">{author}</span><time className="comment-time" dateTime={comment.createdAt}>{relativeTime(comment.createdAt)}{comment.version > 1 && !comment.deletedAt ? ' · edited' : ''}</time></div>
              {comment.deletedAt ? <p className="hint">Comment deleted</p> : <div className="comment-body">{segments(comment.body, comment.mentions).map((part, index) => part.userId ? <mark key={index} className="mention" title={formatPersonName(names.get(part.userId), 'Former member')}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</div>}
              {(permissions.edit || permissions.remove) && <div className="composer-actions">
                {permissions.edit && <button className="btn ghost sm" type="button" disabled={!!drafts.edit || edit.isPending || session.edit.unresolved()} onClick={() => { edit.reset(); session.beginEdit(editDraftFromComment(comment)); }}>Edit your comment</button>}
                {permissions.remove && <button className="btn ghost sm" type="button" disabled={remove.isPending || !!drafts.remove || drafts.edit?.commentId === comment.id} aria-label={`${comment.authorId === actorId ? 'Delete your' : 'Moderate'} comment by ${author}`} onClick={() => { remove.reset(); session.update({ remove: { id: comment.id, version: comment.version } }); setDeleteVisible(true); }}>Delete</button>}
              </div>}
            </div>
          </article>;
        })}
        {!unavailable && feed.data && <p className="hint" role="status">{comments.length} comment {comments.length === 1 ? 'entry' : 'entries'} loaded{feed.hasNextPage ? ' · More comments available' : ' · All entries loaded'}.</p>}
        {!unavailable && feed.hasNextPage && <button className="btn sm" type="button" disabled={feed.isFetching || staleCursor} onClick={() => void feed.fetchNextPage()}>{feed.isFetchingNextPage ? 'Loading comments…' : 'Load more comments'}</button>}
      </div>

      {!drafts.edit && session.edit.unresolved() && <section aria-label="Pending comment edit">
        <p className="hint" role="status">A previous comment edit may have been saved. Retry the original request to confirm its outcome.</p>
        {(!writable || !feed.isSuccess || unavailable) && <p className="hint">Reload comments to verify current access before retrying. <button className="btn sm" type="button" disabled={feed.isFetching} onClick={() => void feed.refetch()}>Reload comments</button></p>}
        {edit.error != null && <ErrorNote error={edit.error} />}
        <button className="btn sm" type="button" disabled={edit.isPending || !writable || !feed.isSuccess || !!unavailable} onClick={() => edit.mutate()}>{edit.isPending ? 'Checking original edit…' : 'Retry original comment edit'}</button>
      </section>}

      {drafts.edit && <section aria-label="Edit your comment">
        <h3>Edit your comment</h3>
        {targetEdit && targetEdit.version !== drafts.edit.expectedVersion && !session.edit.unresolved() && <p className="hint" role="status">The saved comment changed. Review the latest version above; your text is kept. {editAllowed && <button className="btn sm" type="button" onClick={() => { const draft = session.get().edit; if (draft) { session.update({ edit: { ...draft, expectedVersion: targetEdit.version } }); edit.reset(); } }}>Use latest version, keep my text</button>}</p>}
        {!editAllowed && <p className="hint" role="status">This comment is not currently editable. Your draft is kept; reload comments to check access.</p>}
        <CommentComposer key={drafts.edit.commentId} cardId={cardId} projectId={projectId} actorId={actorId} draft={drafts.edit} editing
          onChange={(draft) => { const current = session.get().edit; if (current) { session.update({ edit: { ...current, ...draft } }); edit.reset(); } }}
          onSubmit={() => edit.mutate()} busy={edit.isPending} unresolved={session.edit.unresolved()} writable={writable && (!!editAllowed || session.edit.unresolved()) && !unavailable} error={edit.error}
          onCancel={() => { session.update({ edit: null }); edit.reset(); }} />
      </section>}

      {(writable || drafts.create.body) ? <div ref={createInput}><CommentComposer cardId={cardId} projectId={projectId} actorId={actorId} draft={drafts.create}
        onChange={(draft) => { session.update({ create: draft }); post.reset(); }} onSubmit={() => post.mutate()} busy={post.isPending} unresolved={session.post.unresolved()} writable={writable && !unavailable} error={post.error} /></div>
        : <p className="viewer-notice"><Icon name="lock" />Read-only access. Viewers can read comments and history.</p>}

      {drafts.remove && !deleteVisible && <p className="hint" role="status">A comment deletion still needs your attention. <button className="btn sm" type="button" onClick={() => setDeleteVisible(true)}>Review deletion</button></p>}
      <DialogLayer open={!!drafts.remove && deleteVisible} onClose={() => { if (!remove.isPending) setDeleteVisible(false); }} labelledBy="deleteCommentTitle" describedBy="deleteCommentCopy" role="alertdialog">
        <header className="dialog-head"><h2 id="deleteCommentTitle">Delete this comment?</h2></header>
        <div className="dialog-body">
          <p id="deleteCommentCopy">The comment body will be hidden. Its author and deletion history remain. This cannot be undone.</p>
          {session.remove.unresolved() && <p role="status">The server may have deleted it. Retry the original request to confirm.</p>}
          {remove.error != null && <ErrorNote error={remove.error} focusOnMount />}
          {!removeAllowed && !session.remove.unresolved() && <p role="status">The comment changed or is no longer available. Cancel and reload comments before trying again.</p>}
        </div>
        <footer className="dialog-foot"><button className="btn" type="button" data-autofocus disabled={remove.isPending} onClick={() => { if (!session.remove.unresolved()) session.update({ remove: null }); setDeleteVisible(false); }}>{session.remove.unresolved() ? 'Close and keep pending request' : 'Keep comment'}</button>
          <button className="btn danger" type="button" disabled={remove.isPending || (!removeAllowed && !session.remove.unresolved()) || !writable || !!unavailable} onClick={() => remove.mutate()}>{remove.isPending ? 'Deleting…' : session.remove.unresolved() ? 'Retry original deletion' : 'Delete comment'}</button></footer>
      </DialogLayer>
    </>
  );
}
