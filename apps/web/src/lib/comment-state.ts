import type { Comment, PostCommentInput, EditCommentInput, DeleteCommentInput } from '@flowboard/contracts';
import type { Role } from './roles.ts';
import type { Mention } from './mentions.ts';
import { createRetainedCommand } from './retained-command.ts';
import { setUnsaved } from './unsaved.ts';
import { registerProtectedDraft, type DraftResource } from './protected-drafts.ts';

export interface ComposerDraft { body: string; mentions: Mention[] }
export interface EditDraft extends ComposerDraft { commentId: string; expectedVersion: number }
export interface CommentDrafts { create: ComposerDraft; edit: EditDraft | null; remove: { id: string; version: number } | null }
const emptyDraft = (): ComposerDraft => ({ body: '', mentions: [] });

/** In-memory, actor/card scoped safe unsent text; never persisted to localStorage or shared between accounts. */
export function createCommentSessions() {
  const sessions = new Map<string, { session: ReturnType<typeof makeSession>; resource: DraftResource }>();
  function makeSession(key: string, resource: DraftResource) {
    let drafts: CommentDrafts = { create: emptyDraft(), edit: null, remove: null };
    let editBaseline: EditDraft | null = null;
    const listeners = new Set<() => void>();
    const post = createRetainedCommand<PostCommentInput>();
    const edit = createRetainedCommand<{ id: string; input: EditCommentInput }>();
    const remove = createRetainedCommand<{ id: string; input: DeleteCommentInput }>();
    const session = {
      post, edit, remove,
      get: () => drafts,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      update(patch: Partial<CommentDrafts>) {
        drafts = { ...drafts, ...structuredClone(patch) };
        if (patch.edit === null) editBaseline = null;
        setUnsaved(key, !!drafts.create.body || drafts.edit !== null || drafts.remove !== null || post.unresolved() || edit.unresolved() || remove.unresolved());
        listeners.forEach((listener) => listener());
      },
      beginEdit(draft: EditDraft) { editBaseline = structuredClone(draft); this.update({ edit: draft }); },
      reconcile(comments: ReadonlyArray<Pick<Comment, 'id' | 'deletedAt'>>) {
        if (drafts.edit && comments.some(comment => comment.id === drafts.edit?.commentId && comment.deletedAt)) redactFetchedCopy();
      },
      clear() { this.update({ create: emptyDraft(), edit: null, remove: null }); },
    };
    function redactFetchedCopy() {
      // A version-only reconciliation is not an authored change. The command retains its
      // original input separately if its outcome is still unknown.
      const unchanged = editBaseline && drafts.edit && drafts.edit.commentId === editBaseline.commentId
        && drafts.edit.body === editBaseline.body && JSON.stringify(drafts.edit.mentions) === JSON.stringify(editBaseline.mentions);
      editBaseline = null;
      if (unchanged) session.update({ edit: null });
    }
    registerProtectedDraft(session, resource, redactFetchedCopy);
    return session;
  }
  return {
    forCard(actorId: string, cardId: string, scope: Pick<DraftResource, 'projectId' | 'boardId'> = {}) {
      const key = `comments:${JSON.stringify([actorId, cardId])}`;
      let entry = sessions.get(key);
      if (!entry) { const resource = { ...scope, actorId, cardId }; entry = { session: makeSession(key, resource), resource }; sessions.set(key, entry); }
      // The drawer and comments share the same globally unique card session. Add
      // verified ancestry when the card response is available, without replacing it.
      Object.assign(entry.resource, scope);
      return entry.session;
    },
    clear() { sessions.forEach(({ session }) => session.clear()); sessions.clear(); },
  };
}
export const commentSessions = createCommentSessions();

export function commentPermissions(role: Role, actorId: string | null, comment: Pick<Comment, 'authorId' | 'deletedAt'>) {
  const writable = role !== 'viewer' && !!actorId && !comment.deletedAt;
  return { edit: writable && actorId === comment.authorId, remove: writable && (actorId === comment.authorId || role === 'owner' || role === 'manager') };
}

export function editDraftFromComment(comment: Pick<Comment, 'id' | 'version' | 'body' | 'mentions'>): EditDraft {
  const mentions: Mention[] = [];
  for (const span of comment.mentions) {
    const text = comment.body.slice(span.start, span.end);
    if (span.start < 0 || span.end > comment.body.length || span.start >= span.end || !text.startsWith('@') || text.length < 2) continue;
    mentions.push({ ...span, name: text.slice(1) });
  }
  return { commentId: comment.id, expectedVersion: comment.version, body: comment.body, mentions };
}

export const isComposingInput = (event: { isComposing?: boolean; keyCode?: number }) => event.isComposing === true || event.keyCode === 229;

export interface CursorPage<T> { data: T[]; nextCursor: string | null }
export function validateCursorPage<T>(page: CursorPage<T>, requestedCursor: string | null): CursorPage<T> {
  if (page.nextCursor && page.nextCursor === requestedCursor) throw Object.assign(new Error('The page cursor did not advance. Reload the list; your draft is kept.'), { status: 409, code: 'STALE_CURSOR' });
  return page;
}
/** Duplicate boundary IDs keep their position, but a newer edit/tombstone replaces an older body. */
export function mergeCursorPages<T extends { id: string; version?: number }>(pages: ReadonlyArray<CursorPage<T>> | undefined): T[] {
  const items = new Map<string, T>();
  for (const page of pages ?? []) for (const item of page.data) {
    const previous = items.get(item.id);
    if (!previous || (item.version ?? 0) >= (previous.version ?? 0)) items.set(item.id, item);
  }
  return [...items.values()];
}
