'use client';

import { useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, MessageSquare, Paperclip, Lock } from 'lucide-react';
import type { Card, CardSummary, ColumnSummary, PersonDisplay } from '@flowboard/contracts';
import { api, ApiError } from '@/lib/api';
import { describeError } from '@/lib/errors';

interface Props {
  cardId: string;
  summary: CardSummary | null;
  columns: ColumnSummary[];
  people: Map<string, PersonDisplay>;
  boardStructureVersion: number;
  onClose: () => void;
  onChanged: () => void;
  onMoved: (message: string) => void;
}

export function CardDetailDialog({ cardId, summary, columns, people, boardStructureVersion, onClose, onChanged, onMoved }: Props) {
  const cardQuery = useQuery({
    queryKey: ['card', cardId],
    queryFn: async () => (await api.getCard(cardId)).data,
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 1,
  });
  const card = cardQuery.data;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className="fixed right-0 top-0 z-50 h-full w-full max-w-2xl border-l border-line bg-surface shadow-2xl flex flex-col">
          <div className="border-b border-line px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-bold text-ink truncate">{card?.title ?? summary?.title ?? 'Card'}</Dialog.Title>
              <Dialog.Description className="text-xs text-muted">Card details</Dialog.Description>
            </div>
            <button type="button" onClick={onClose} aria-label="Close card detail" className="p-2 rounded-lg text-muted hover:bg-surface-3 focus-visible:outline-2"><X className="w-5 h-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">
            {cardQuery.isPending && <p role="status" className="text-sm text-muted">Loading card...</p>}
            {cardQuery.isError && (
              <p role="alert" className="text-sm text-danger">
                {cardQuery.error instanceof ApiError && [403, 404].includes(cardQuery.error.status) ? 'This card does not exist or you cannot open it.' : describeError(cardQuery.error)}
              </p>
            )}
            {card && (
              <>
                <CardEditor key={card.version} card={card} columns={columns} people={people} boardStructureVersion={boardStructureVersion} onClose={onClose} onChanged={() => { void cardQuery.refetch(); onChanged(); }} onMoved={onMoved} />
                <Comments cardId={card.id} people={people} onChanged={onChanged} />
                <section className="rounded-xl border border-line bg-surface-2 p-4">
                  <h3 className="text-xs font-bold text-ink flex items-center gap-2"><Paperclip className="w-4 h-4" aria-hidden="true" />Images <Lock className="w-3 h-3" aria-hidden="true" /></h3>
                  <p className="mt-2 text-xs text-muted">Coming soon.</p>
                </section>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CardEditor({ card, columns, people, boardStructureVersion, onClose, onChanged, onMoved }: {
  card: Card; columns: ColumnSummary[]; people: Map<string, PersonDisplay>; boardStructureVersion: number;
  onClose: () => void; onChanged: () => void; onMoved: (message: string) => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [priority, setPriority] = useState(card.priority);
  const [dueDate, setDueDate] = useState(card.dueDate ?? '');
  const [assigneeIds, setAssigneeIds] = useState(card.assigneeIds);
  const [error, setError] = useState('');
  const [moveTarget, setMoveTarget] = useState(card.columnId);
  const assignable = [...people.values()].filter((p) => p.activeInProject && p.assignable !== false);

  const dirty = title !== card.title || description !== card.description || priority !== card.priority || dueDate !== (card.dueDate ?? '') || assigneeIds.join(',') !== card.assigneeIds.join(',');

  const save = useMutation({
    mutationFn: () => api.updateCard(card.id, {
      title: title.trim(),
      description,
      priority,
      dueDate: dueDate || null,
      assigneeIds,
      expectedVersion: card.version,
    }),
    onSuccess: () => { setError(''); onChanged(); },
    onError: (err) => { setError(describeError(err)); onChanged(); },
  });

  const move = useMutation({
    mutationFn: () => {
      const dest = columns.find((c) => c.id === moveTarget);
      const last = [...(dest?.cards ?? [])].filter((c) => c.id !== card.id).sort((a, b) => a.position - b.position).at(-1);
      return api.moveCard(card.id, { toColumnId: moveTarget, previousCardId: last?.id ?? null, nextCardId: null, expectedVersion: card.version, expectedBoardVersion: boardStructureVersion });
    },
    onSuccess: () => { onMoved(`Moved to ${columns.find((c) => c.id === moveTarget)?.name ?? 'column'}.`); onChanged(); },
    onError: (err) => { setError(describeError(err)); onChanged(); },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || title.trim().length > 200) { setError('Enter a title with 1 to 200 characters.'); return; }
    setError('');
    save.mutate();
  };

  return (
    <>
      <form id="card-edit" noValidate onSubmit={submit} className="space-y-5">
        <div>
          <label htmlFor="detail-title" className="block text-xs font-bold text-ink mb-1">Title</label>
          <input id="detail-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-lg font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-line bg-surface-2 p-4 text-xs">
          <div>
            <label htmlFor="detail-priority" className="block font-bold text-ink mb-1">Priority</label>
            <select id="detail-priority" value={priority} onChange={(e) => setPriority(e.target.value as Card['priority'])} className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-ink">
              <option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label htmlFor="detail-date" className="block font-bold text-ink mb-1">Due date</label>
            <input id="detail-date" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-ink" />
          </div>
        </div>
        {assignable.length > 0 && (
          <fieldset>
            <legend className="text-xs font-bold text-ink mb-2">Assignees</legend>
            <div className="flex flex-wrap gap-2">
              {assignable.map((p) => (
                <button key={p.id} type="button" aria-pressed={assigneeIds.includes(p.id)} onClick={() => setAssigneeIds((prev) => prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id])} className={`rounded-full border px-2.5 py-1.5 text-xs focus-visible:outline-2 ${assigneeIds.includes(p.id) ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:bg-surface-3'}`}>{p.displayName}</button>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <label htmlFor="detail-description" className="block text-xs font-bold text-ink mb-1">Description</label>
          <textarea id="detail-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={20000} className="w-full rounded-lg border border-line bg-surface p-3 text-sm text-ink resize-none focus-visible:outline-2" />
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-xs text-muted hover:bg-surface-2">Close</button>
          <button type="submit" disabled={!dirty || save.isPending} className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] hover:bg-accent-hover disabled:opacity-50">{save.isPending ? 'Saving...' : 'Save changes'}</button>
        </div>
      </form>
      <section aria-label="Move card" className="rounded-xl border border-line bg-surface-2 p-4 flex flex-wrap items-end gap-3 text-xs">
        <div className="flex-1 min-w-[10rem]">
          <label htmlFor="detail-column" className="block font-bold text-ink mb-1">Column</label>
          <select id="detail-column" value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} className="w-full rounded-lg border border-line bg-surface px-2 py-2 text-ink">
            {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button type="button" disabled={moveTarget === card.columnId || move.isPending || dirty} onClick={() => move.mutate()} className="rounded-lg border border-line bg-surface px-4 py-2 font-semibold text-ink hover:bg-surface-3 disabled:opacity-50">{move.isPending ? 'Moving...' : 'Move card'}</button>
        {dirty && <p className="basis-full text-[11px] text-muted">Save or discard your edits before moving.</p>}
      </section>
    </>
  );
}

function Comments({ cardId, people, onChanged }: { cardId: string; people: Map<string, PersonDisplay>; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const key = useRef<string>(crypto.randomUUID());
  const list = useQuery({ queryKey: ['comments', cardId], queryFn: async () => (await api.listCardComments(cardId)).data });
  const post = useMutation({
    mutationFn: () => api.postCardComment(cardId, { body: body.trim(), mentions: [] }, key.current),
    onSuccess: () => {
      setBody(''); setError(''); key.current = crypto.randomUUID();
      void queryClient.invalidateQueries({ queryKey: ['comments', cardId] });
      onChanged();
    },
    onError: (err) => setError(describeError(err)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) { setError('Write a comment first.'); return; }
    post.mutate();
  };
  const comments = (list.data ?? []).filter((c) => !c.deletedAt);
  return (
    <section className="rounded-xl border border-line bg-surface-2 p-4">
      <h3 className="text-xs font-bold text-ink flex items-center gap-2"><MessageSquare className="w-4 h-4" aria-hidden="true" />Comments</h3>
      {list.isPending && <p className="mt-2 text-xs text-muted">Loading comments...</p>}
      {list.isError && <p role="alert" className="mt-2 text-xs text-danger">{describeError(list.error)}</p>}
      {list.isSuccess && comments.length === 0 && <p className="mt-2 text-xs text-muted">No comments yet.</p>}
      <ul className="mt-3 space-y-3">
        {comments.map((c) => (
          <li key={c.id} className="rounded-lg border border-line bg-surface p-3">
            <p className="text-[11px] font-semibold text-ink">{c.author?.displayName ?? people.get(c.authorId)?.displayName ?? 'Former member'} <span className="font-normal text-muted">· {new Date(c.createdAt).toLocaleString()}</span></p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{c.body}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="mt-3 space-y-2">
        <label htmlFor="comment-body" className="sr-only">Add a comment</label>
        <textarea id="comment-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={10000} placeholder="Write a comment" className="w-full rounded-lg border border-line bg-surface p-3 text-sm text-ink resize-none focus-visible:outline-2" />
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end"><button type="submit" disabled={post.isPending} className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-[var(--accent-ink)] hover:bg-accent-hover disabled:opacity-50">{post.isPending ? 'Posting...' : 'Post comment'}</button></div>
      </form>
    </section>
  );
}
